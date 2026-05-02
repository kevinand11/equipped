// Parallel Planner with Review + Publish + Feedback — orchestration loop
//
// Phase 0 (Address Feedback): For each open Sandcastle-authored PR carrying
//                             the `needs-revision` label, spawn a sandbox on
//                             the PR's branch and run an "addresser" agent.
//                             Push the branch back and remove the label when
//                             done. Pipelines run concurrently.
//                             (GitHub doesn't let PR authors request changes
//                             on their own PR, so a label is the trigger.)
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
import { Command, InvalidArgumentError } from "commander"

const exec = promisify(execFile)

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const parsePositiveInt = (raw: string): number => {
	const n = Number.parseInt(raw, 10)
	if (!Number.isFinite(n) || n < 1) {
		throw new InvalidArgumentError(`must be a positive integer (got '${raw}')`)
	}
	return n
}

const parseFeature = (raw: string): string => {
	if (!raw.startsWith("feature/") || raw === "feature/") {
		throw new InvalidArgumentError(
			`must start with 'feature/' and have a non-empty slug (got '${raw}')`,
		)
	}
	return raw
}

const program = new Command()
	.name("sandcastle")
	.description(
		"Run the Sandcastle parallel-planner-with-review loop scoped to a single feature. Multiple devs can run scoped loops for different features in parallel.",
	)
	.argument(
		"<feature>",
		"feature label (e.g. 'feature/orm') — must start with 'feature/' and exist as a branch on origin",
		parseFeature,
	)
	.option(
		"-m, --max-iterations <n>",
		"maximum number of plan/execute/publish cycles per run",
		parsePositiveInt,
		10,
	)
	.parse()

const FEATURE: string = program.processedArgs[0]
const MAX_ITERATIONS: number = program.opts().maxIterations

const IN_PR_LABEL = "in-pr"
const NEEDS_REVISION_LABEL = "needs-revision"
const SANDCASTLE_BRANCH_PREFIX = "sandcastle/issue-"

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

async function ensureLinkedIssueBranch(
	issueId: string,
	issueBranch: string,
	featureBranch: string,
) {
	// Make sure we have the latest feature-branch tip locally.
	await exec("git", ["fetch", "origin", featureBranch])

	// If the issue branch doesn't yet exist on origin, create it via
	// `gh issue develop` — this both creates the branch on the remote off the
	// feature branch AND links it to the issue (visible in the issue's
	// "Development" sidebar). On re-runs the branch already exists; we leave it
	// alone so prior progress is preserved.
	if (!(await remoteBranchExists(issueBranch))) {
		console.log(`  → Creating linked branch ${issueBranch} for issue #${issueId}`)
		await exec("gh", [
			"issue", "develop", issueId,
			"--name", issueBranch,
			"--base", featureBranch,
		])
		// Fetch the freshly-created remote ref so we can build a local branch on top.
		await exec("git", ["fetch", "origin", issueBranch])
	}

	// Ensure a local branch exists tracking the remote.
	try {
		await exec("git", ["rev-parse", "--verify", `refs/heads/${issueBranch}`])
	} catch {
		await exec("git", ["branch", issueBranch, `origin/${issueBranch}`])
	}
}

async function getPRsNeedingFeedback(): Promise<FeedbackPR[]> {
	// Fetch the latest refs so local branches the agent will check out
	// match what humans see on GitHub.
	await exec("git", ["fetch", "--all", "--prune"])

	// We use a label as the trigger because GitHub doesn't let PR authors
	// request changes on their own PR. The human reviewer adds
	// `needs-revision` after leaving comments; the addresser removes it once
	// it pushes a fix.
	const { stdout } = await exec("gh", [
		"pr", "list",
		"--state", "open",
		"--label", NEEDS_REVISION_LABEL,
		"--limit", "100",
		"--json", "number,title,url,headRefName,baseRefName",
	])

	return (
		JSON.parse(stdout) as Array<{
			number: number
			title: string
			url: string
			headRefName: string
			baseRefName: string
		}>
	)
		.filter((pr) => pr.headRefName.startsWith(SANDCASTLE_BRANCH_PREFIX))
		.filter((pr) => pr.baseRefName === FEATURE)
		.map((pr) => ({
			number: pr.number,
			title: pr.title,
			url: pr.url,
			branch: pr.headRefName,
		}))
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

	// Hit the REST API directly instead of `gh issue edit --add-label` because
	// the latter goes through a GraphQL path that touches the deprecated
	// `projectCards` field and fails on repos with Projects (classic) sunset.
	await exec("gh", [
		"api",
		"--method", "POST",
		`repos/{owner}/{repo}/issues/${issue.id}/labels`,
		"-f", `labels[]=${IN_PR_LABEL}`,
	])
}

async function pushFeedbackBranch(pr: FeedbackPR) {
	console.log(`  → Pushing ${pr.branch} (PR #${pr.number})`)
	await exec("git", ["push", "origin", pr.branch])
	// Hand the ball back to the human reviewer — they re-apply the label if
	// they want another pass.
	//
	// We hit `gh api` directly instead of `gh pr edit --remove-label` because
	// `gh pr edit` issues a GraphQL query that touches the deprecated
	// `repository.pullRequest.projectCards` field and fails outright on repos
	// where Projects (classic) has been sunset. The REST labels endpoint takes
	// a clean DELETE and isn't affected.
	await exec("gh", [
		"api",
		"--method", "DELETE",
		`repos/{owner}/{repo}/issues/${pr.number}/labels/${NEEDS_REVISION_LABEL}`,
	])
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
	// Prepare the issue branch on origin (linked to the issue via
	// `gh issue develop`) and locally, off the feature-branch tip. This
	// ensures the sandbox starts from the right base AND the branch shows up
	// under the issue's "Development" sidebar on GitHub.
	await ensureLinkedIssueBranch(issue.id, issue.branch, issue.featureBranch)

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
