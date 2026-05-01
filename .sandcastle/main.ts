// Parallel Planner with Review + Publish + Feedback — orchestration loop
//
// Phase 0 (Address Feedback): For each open Sandcastle-authored PR with
//                             unaddressed `CHANGES_REQUESTED` review feedback,
//                             spawn a sandbox on the PR's branch and run an
//                             "addresser" agent. Push the branch back when
//                             done. Pipelines run concurrently.
// Phase 1 (Plan):             An opus agent analyses open issues, builds a
//                             dependency graph, and outputs a <plan> JSON
//                             listing unblocked issues with branch names and
//                             their target feature branches.
// Phase 2 (Execute+Review):   For each issue, the host prepares a local issue
//                             branch off the feature branch tip, then a
//                             sandbox is created via createSandbox(). The
//                             implementer runs first (100 iterations). If it
//                             produces commits, a reviewer runs in the same
//                             sandbox on the same branch (1 iteration).
//                             Pipelines run concurrently via Promise.allSettled().
// Phase 3 (Publish):          For each branch with commits, push the branch
//                             to origin and open a PR targeting its feature
//                             branch (or `main` if no feature branch was set).
//                             Label the issue 'in-pr' so subsequent iterations
//                             skip it. No auto-merge — humans review and merge.
//
// The merge phase is intentionally absent — humans review and merge PRs.
//
// Usage:
//   npx tsx .sandcastle/main.ts

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import * as sandcastle from "@ai-hero/sandcastle"
import { docker } from "@ai-hero/sandcastle/sandboxes/docker"

const exec = promisify(execFile)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 10
const IN_PR_LABEL = "in-pr"
const SANDCASTLE_BRANCH_PREFIX = "sandcastle/issue-"

// Scope every iteration to a single feature so multiple devs can run their
// own loops in parallel without colliding on issue selection or feedback PRs.
// Pass via CLI arg (`npm run sandcastle -- feature/<slug>`) or env var
// (`SANDCASTLE_FEATURE=feature/<slug> npm run sandcastle`).
const FEATURE = process.argv[2] ?? process.env.SANDCASTLE_FEATURE ?? ""

if (!FEATURE) {
	throw new Error(
		"Sandcastle loop requires a feature scope. Pass one via CLI arg " +
			"(`npm run sandcastle -- feature/<slug>`) or env var " +
			"(`SANDCASTLE_FEATURE=feature/<slug>`).",
	)
}

if (!FEATURE.startsWith("feature/") || FEATURE === "feature/") {
	throw new Error(
		`Feature scope must start with 'feature/' and have a non-empty slug. Got: '${FEATURE}'.`,
	)
}

// `pnpm install --prefer-offline` matches this repo's package manager and
// reuses cached/host-copied node_modules wherever possible. The default
// 60s hook timeout is too short for a clean install on a non-trivial repo —
// bump it generously. Reduce if you find runs are reliably faster.
const hooks = {
	sandbox: {
		onSandboxReady: [
			{ command: "pnpm install --prefer-offline", timeoutMs: 600_000 },
		],
	},
}

const copyToWorktree = ["node_modules"]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawIssue = {
	id: string
	title: string
	branch: string
	featureLabels: string[]
}

type Issue = {
	id: string
	title: string
	branch: string
	featureBranch: string
}

type FeedbackPR = {
	number: number
	title: string
	branch: string
	url: string
}

// ---------------------------------------------------------------------------
// Host-side helpers
// ---------------------------------------------------------------------------

async function remoteBranchExists(branch: string): Promise<boolean> {
	try {
		await exec("git", ["ls-remote", "--exit-code", "--heads", "origin", branch])
		return true
	} catch {
		return false
	}
}

async function ensureIssueBranchOffFeature(issueBranch: string, featureBranch: string) {
	// Make sure we have the latest feature-branch tip locally.
	await exec("git", ["fetch", "origin", featureBranch])

	// Create the issue branch off the remote feature-branch tip if it doesn't
	// already exist locally. If it exists, leave it alone — a previous run may
	// have made progress on it that we don't want to discard.
	try {
		await exec("git", ["rev-parse", "--verify", `refs/heads/${issueBranch}`])
		// Branch exists locally. Nothing to do — sandcastle will reuse it.
	} catch {
		await exec("git", ["branch", issueBranch, `origin/${featureBranch}`])
	}
}

async function getPRsNeedingFeedback(): Promise<FeedbackPR[]> {
	// Fetch the latest refs so local branches the agent will check out
	// match what humans see on GitHub.
	await exec("git", ["fetch", "--all", "--prune"])

	// Step 1: list candidate PRs with only the minimal fields needed to filter
	// by branch prefix. GitHub's GraphQL rejects the broader query that asked
	// for reviews+commits inline because the (PRs × reviews × commits) fanout
	// exceeds the connection node budget on busy repos.
	const { stdout: listOut } = await exec("gh", [
		"pr", "list",
		"--state", "open",
		"--search", "review:changes-requested",
		"--limit", "100",
		"--json", "number,title,url,headRefName,baseRefName",
	])

	const candidates = (
		JSON.parse(listOut) as Array<{
			number: number
			title: string
			url: string
			headRefName: string
			baseRefName: string
		}>
	)
		.filter((pr) => pr.headRefName.startsWith(SANDCASTLE_BRANCH_PREFIX))
		.filter((pr) => pr.baseRefName === FEATURE)

	// Step 2: per-PR detail fetch (single PR per call stays well under the
	// GraphQL node limit).
	const result: FeedbackPR[] = []
	for (const c of candidates) {
		const { stdout: detailOut } = await exec("gh", [
			"pr", "view", String(c.number),
			"--json", "reviews,commits",
		])
		const detail = JSON.parse(detailOut) as {
			reviews: Array<{ state: string; submittedAt: string }>
			commits: Array<{ committedDate: string }>
		}

		const submitted = detail.reviews.filter((r) => r.state !== "PENDING")
		if (submitted.length === 0) continue

		const lastReviewAt = submitted
			.map((r) => new Date(r.submittedAt).getTime())
			.reduce((a, b) => Math.max(a, b), 0)
		const lastCommitAt = detail.commits
			.map((cm) => new Date(cm.committedDate).getTime())
			.reduce((a, b) => Math.max(a, b), 0)

		// Feedback is unaddressed when the latest review is newer than the
		// latest commit on the branch. After the addresser pushes new commits,
		// lastCommitAt overtakes lastReviewAt and the PR drops out of this
		// list until a human re-reviews and requests more changes.
		if (lastReviewAt > lastCommitAt) {
			result.push({
				number: c.number,
				title: c.title,
				url: c.url,
				branch: c.headRefName,
			})
		}
	}

	return result
}

async function publishNewIssue(issue: Issue) {
	console.log(`  → Pushing ${issue.branch}`)
	await exec("git", ["push", "-u", "origin", issue.branch])

	console.log(`  → Opening PR for issue #${issue.id} → ${issue.featureBranch}`)
	const { stdout } = await exec("gh", [
		"pr", "create",
		"--head", issue.branch,
		"--base", issue.featureBranch,
		"--title", `Sandcastle: ${issue.title} (#${issue.id})`,
		"--body", [
			`Automated implementation by Sandcastle for issue #${issue.id}.`,
			"",
			`Closes #${issue.id}`,
			"",
			`_Awaiting human review and approval. This PR targets the long-lived feature branch \`${issue.featureBranch}\`._`,
		].join("\n"),
	])
	const url = stdout.trim()
	console.log(`  → PR opened: ${url}`)

	await exec("gh", ["issue", "edit", issue.id, "--add-label", IN_PR_LABEL])
}

async function pushFeedbackBranch(pr: FeedbackPR) {
	console.log(`  → Pushing ${pr.branch} (PR #${pr.number})`)
	await exec("git", ["push", "origin", pr.branch])
}

// ---------------------------------------------------------------------------
// Sandbox runs
// ---------------------------------------------------------------------------

async function addressFeedback(pr: FeedbackPR) {
	const sandbox = await sandcastle.createSandbox({
		branch: pr.branch,
		sandbox: docker(),
		hooks,
		copyToWorktree,
	})

	try {
		const result = await sandbox.run({
			name: `addresser-pr${pr.number}`,
			maxIterations: 50,
			agent: sandcastle.claudeCode("claude-opus-4-6"),
			promptFile: "./.sandcastle/respond-to-feedback-prompt.md",
			promptArgs: {
				PR_NUMBER: String(pr.number),
				BRANCH: pr.branch,
			},
		})
		return { pr, commits: result.commits }
	} finally {
		await sandbox.close()
	}
}

async function implementAndReview(issue: Issue) {
	// Prepare the local issue branch as a child of the feature-branch tip.
	// This ensures the sandbox starts from the right base, even if the local
	// repo's HEAD or the issue branch is stale.
	await ensureIssueBranchOffFeature(issue.branch, issue.featureBranch)

	const sandbox = await sandcastle.createSandbox({
		branch: issue.branch,
		sandbox: docker(),
		hooks,
		copyToWorktree,
	})

	try {
		const implement = await sandbox.run({
			name: "implementer",
			maxIterations: 100,
			agent: sandcastle.claudeCode("claude-opus-4-6"),
			promptFile: "./.sandcastle/implement-prompt.md",
			promptArgs: {
				TASK_ID: issue.id,
				ISSUE_TITLE: issue.title,
				BRANCH: issue.branch,
			},
		})

		if (implement.commits.length === 0) {
			return { issue, commits: [] as { sha: string }[] }
		}

		const review = await sandbox.run({
			name: "reviewer",
			maxIterations: 1,
			agent: sandcastle.claudeCode("claude-opus-4-6"),
			promptFile: "./.sandcastle/review-prompt.md",
			promptArgs: {
				BRANCH: issue.branch,
				FEATURE_BRANCH: issue.featureBranch,
			},
		})

		return {
			issue,
			commits: [...implement.commits, ...review.commits],
		}
	} finally {
		await sandbox.close()
	}
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

console.log(`Sandcastle scoped to feature: ${FEATURE}`)

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
	console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} (${FEATURE}) ===\n`)

	// Phase 0: Address feedback on open Sandcastle PRs
	const feedbackPRs = await getPRsNeedingFeedback()
	if (feedbackPRs.length > 0) {
		console.log(`Addressing feedback on ${feedbackPRs.length} PR(s):`)
		for (const pr of feedbackPRs) console.log(`  PR #${pr.number}: ${pr.title} (${pr.branch})`)

		const settled = await Promise.allSettled(feedbackPRs.map(addressFeedback))
		for (const [i, outcome] of settled.entries()) {
			const pr = feedbackPRs[i]!
			if (outcome.status === "rejected") {
				console.error(`  ✗ PR #${pr.number} addresser failed: ${outcome.reason}`)
				continue
			}
			if (outcome.value.commits.length === 0) {
				console.log(`  · PR #${pr.number} addresser made no commits (likely pushed-back-only).`)
				continue
			}
			try {
				await pushFeedbackBranch(pr)
			} catch (err) {
				console.error(`  ✗ PR #${pr.number} push failed: ${(err as Error).message}`)
			}
		}
	} else {
		console.log("No open PRs need feedback addressed.")
	}

	// Phase 1: Plan new work (scoped to FEATURE)
	const plan = await sandcastle.run({
		hooks,
		sandbox: docker(),
		name: "planner",
		maxIterations: 1,
		agent: sandcastle.claudeCode("claude-opus-4-6"),
		promptFile: "./.sandcastle/plan-prompt.md",
		promptArgs: { FEATURE },
	})

	const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/)
	if (!planMatch) {
		throw new Error("Planning agent did not produce a <plan> tag.\n\n" + plan.stdout)
	}

	const rawIssues = (JSON.parse(planMatch[1]!) as { issues: RawIssue[] }).issues

	// Validate that every issue declares exactly one `feature/*` label, and
	// that the named feature branch exists on origin. Any violation halts the
	// run loudly — there is no fallback to `main`.
	const issues: Issue[] = []
	for (const raw of rawIssues) {
		if (raw.featureLabels.length === 0) {
			throw new Error(
				`Issue #${raw.id} ("${raw.title}") has no \`feature/*\` label. ` +
					`Every Sandcastle issue must declare its target feature branch via a \`feature/*\` label. ` +
					`Add one (e.g. \`gh issue edit ${raw.id} --add-label "feature/<slug>"\`) and re-run.`,
			)
		}
		if (raw.featureLabels.length > 1) {
			throw new Error(
				`Issue #${raw.id} ("${raw.title}") has multiple \`feature/*\` labels: ${raw.featureLabels.join(", ")}. ` +
					`Each issue must target exactly one feature branch. Remove the extras with \`gh issue edit\` and re-run.`,
			)
		}
		const featureBranch = raw.featureLabels[0]!
		if (featureBranch !== FEATURE) {
			throw new Error(
				`Issue #${raw.id} ("${raw.title}") declares feature '${featureBranch}', but this loop is scoped to '${FEATURE}'. ` +
					`The planner should only return issues matching the scope; this is a planner bug or a stale label cache.`,
			)
		}
		if (!(await remoteBranchExists(featureBranch))) {
			throw new Error(
				`Feature branch '${featureBranch}' (declared by issue #${raw.id}) does not exist on origin. ` +
					`Create it before labelling issues — e.g. \`git checkout -b ${featureBranch} main && git push -u origin ${featureBranch}\`.`,
			)
		}
		issues.push({ id: raw.id, title: raw.title, branch: raw.branch, featureBranch })
	}

	if (issues.length === 0) {
		console.log("No unblocked issues to work on.")
		// If there was also no feedback work this iteration, the queue is empty.
		if (feedbackPRs.length === 0) {
			console.log("Queue empty. Exiting.")
			break
		}
		continue
	}

	console.log(`Planning complete. ${issues.length} issue(s) to work in parallel:`)
	for (const issue of issues) {
		console.log(`  ${issue.id}: ${issue.title} → ${issue.branch} (base: ${issue.featureBranch})`)
	}

	// Phase 2: Execute + Review
	const settled = await Promise.allSettled(issues.map(implementAndReview))

	for (const [i, outcome] of settled.entries()) {
		if (outcome.status === "rejected") {
			console.error(`  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`)
		}
	}

	// Phase 3: Publish — push branches and open PRs
	const completed = settled
		.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []))
		.filter((v) => v.commits.length > 0)

	if (completed.length === 0) {
		console.log("No commits produced. Nothing to publish.")
		continue
	}

	console.log(`\nPublishing ${completed.length} branch(es):`)
	for (const { issue } of completed) {
		try {
			await publishNewIssue(issue)
		} catch (err) {
			console.error(`  ✗ ${issue.id}: publish failed: ${(err as Error).message}`)
		}
	}
}

console.log("\nAll done.")
