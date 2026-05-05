// Parallel Planner with Review + Publish + Feedback — orchestration loop
//
// Phase 0 (Address Feedback): For each open Sandcastle-authored PR carrying
//                             the `needs-revision` label, spawn a sandbox on
//                             the PR's branch and run an "addresser" agent.
//                             Push the branch back and remove the label when
//                             done. Pipelines run concurrently.
//                             (GitHub doesn't let PR authors request changes
//                             on their own PR, so a label is the trigger.)
// Phase 1 (Plan):             Host fetches open `ready-for-agent` issues for
//                             this feature, parses `Depends on #N` / `Blocked
//                             by #N` trailers from issue bodies, and filters
//                             out anything whose deps aren't all closed.
//                             Bad refs and dep cycles hard-fail the run.
//                             The surviving subset is then handed to an opus
//                             agent that builds a heuristic dependency graph
//                             (overlapping files, decision-shape ordering)
//                             and outputs a <plan> JSON listing unblocked
//                             issues with branch names and feature labels.
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

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as sandcastle from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'
import { Command, InvalidArgumentError } from 'commander'

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
	if (!raw.startsWith('feature/') || raw === 'feature/') {
		throw new InvalidArgumentError(`must start with 'feature/' and have a non-empty slug (got '${raw}')`)
	}
	return raw
}

const program = new Command()
	.name('sandcastle')
	.description(
		'Run the Sandcastle parallel-planner-with-review loop scoped to a single feature. Multiple devs can run scoped loops for different features in parallel.',
	)
	.argument('<feature>', "feature label (e.g. 'feature/orm') — must start with 'feature/' and exist as a branch on origin", parseFeature)
	.option('-m, --max-iterations <n>', 'maximum number of plan/execute/publish cycles per run', parsePositiveInt, 1)
	.parse()

const FEATURE: string = program.processedArgs[0]
const MAX_ITERATIONS: number = program.opts().maxIterations

const IN_PR_LABEL = 'in-pr'
const NEEDS_REVISION_LABEL = 'needs-revision'
const SANDCASTLE_BRANCH_PREFIX = 'sandcastle/issue-'

// `pnpm install --prefer-offline` matches this repo's package manager and
// reuses cached/host-copied node_modules wherever possible. The default
// 60s hook timeout is too short for a clean install on a non-trivial repo —
// bump it generously. Reduce if you find runs are reliably faster.
const hooks = {
	sandbox: {
		onSandboxReady: [{ command: 'pnpm install --prefer-offline', timeoutMs: 600_000 }],
	},
}

const copyToWorktree = ['node_modules']

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

type CandidateIssue = {
	number: number
	title: string
	body: string
	labels: string[]
	comments: string[]
}

type IssueState = 'OPEN' | 'CLOSED'

// Inline form: matches lines that *begin* with `Depends on` / `Blocked by`
// (case-insensitive). The line-start anchor keeps mid-paragraph mentions like
// "this depends on #42 in some way" out — only intentional declarations at the
// start of a line count. Multiple refs and parenthetical annotations on the
// same line are fine; we truncate at the first sentence terminator (`.` or
// `;`) so trailing prose (e.g. "Depends on #8, #10. Parallel-safe with #11.")
// doesn't pull in incidental refs like #11.
const DEPS_LINE_RE = /^[\t ]*(?:Depends on|Blocked by)\b.*$/gim
// Block form: matches a markdown heading line that consists *only* of the
// keyword (e.g. `## Blocked by`). The parser then collects refs from each
// subsequent line until the next markdown heading or end of body.
const DEPS_BLOCK_HEAD_RE = /^[\t ]*#+[\t ]+(?:Depends on|Blocked by)[\t ]*$/i
// Markdown ATX heading: one-or-more `#` followed by whitespace and content.
// The whitespace requirement distinguishes a heading from an issue ref like
// `#28` (no space after `#`).
const HEADING_RE = /^[\t ]*#+[\t ]+\S/
// Bare `#N` not preceded by a word char or `/` — this excludes cross-repo
// refs (`owner/repo#42`) which we don't support.
const ISSUE_REF_RE = /(?<![\w/])#(\d+)\b/g

// ---------------------------------------------------------------------------
// Host-side helpers
// ---------------------------------------------------------------------------

async function remoteBranchExists(branch: string): Promise<boolean> {
	try {
		await exec('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch])
		return true
	} catch {
		return false
	}
}

function parseDeps(body: string): number[] {
	const out = new Set<number>()
	const collectRefs = (line: string) => {
		const head = line.split(/[.;]/, 1)[0]!
		for (const refMatch of head.matchAll(ISSUE_REF_RE)) {
			out.add(Number.parseInt(refMatch[1]!, 10))
		}
	}
	// Inline form
	for (const lineMatch of body.matchAll(DEPS_LINE_RE)) {
		collectRefs(lineMatch[0])
	}
	// Block form: scan lines, when a `## Depends on` / `## Blocked by` heading
	// is found, collect refs from subsequent lines until the next markdown
	// heading or end of body.
	const lines = body.split('\n')
	for (let i = 0; i < lines.length; i++) {
		if (!DEPS_BLOCK_HEAD_RE.test(lines[i]!)) continue
		for (let j = i + 1; j < lines.length; j++) {
			if (HEADING_RE.test(lines[j]!)) break
			collectRefs(lines[j]!)
		}
	}
	return [...out]
}

async function fetchCandidates(feature: string): Promise<CandidateIssue[]> {
	const { stdout } = await exec('gh', [
		'issue', 'list',
		'--state', 'open',
		'--search', `label:ready-for-agent label:"${feature}" -label:in-pr`,
		'--limit', '200',
		'--json', 'number,title,body,labels,comments',
	])
	return (
		JSON.parse(stdout) as Array<{
			number: number
			title: string
			body: string
			labels: Array<{ name: string }>
			comments: Array<{ body: string }>
		}>
	).map((raw) => ({
		number: raw.number,
		title: raw.title,
		body: raw.body ?? '',
		labels: raw.labels.map((l) => l.name),
		comments: raw.comments.map((c) => c.body),
	}))
}

// `gh issue view` per number with a memoising cache. Issues referenced by
// trailers may live anywhere in the repo, so we don't bound this by labels.
// Returns `null` if the issue does not exist (gh exits non-zero).
async function getIssueState(
	cache: Map<number, IssueState | null>,
	number: number,
): Promise<IssueState | null> {
	const cached = cache.get(number)
	if (cached !== undefined) return cached
	let state: IssueState | null
	try {
		const { stdout } = await exec('gh', ['issue', 'view', String(number), '--json', 'state'])
		state = (JSON.parse(stdout) as { state: IssueState }).state
	} catch {
		state = null
	}
	cache.set(number, state)
	return state
}

// Walk the dep graph reachable from the candidate set and detect cycles via
// classic 3-colour DFS. Only follows refs whose state is OPEN — a closed dep
// can't form a live cycle, even if it sits on the path. Returns the first
// cycle found (as an ordered list of issue numbers, e.g. `[42, 50, 42]`) or
// null if the graph is acyclic.
async function findCycle(
	candidates: CandidateIssue[],
	depsByNumber: Map<number, number[]>,
	stateCache: Map<number, IssueState | null>,
): Promise<number[] | null> {
	const colour = new Map<number, 'gray' | 'black'>()
	const stack: number[] = []

	async function visit(n: number): Promise<number[] | null> {
		if (colour.get(n) === 'black') return null
		if (colour.get(n) === 'gray') {
			const start = stack.indexOf(n)
			return [...stack.slice(start), n]
		}
		const state = await getIssueState(stateCache, n)
		if (state !== 'OPEN') {
			colour.set(n, 'black')
			return null
		}
		colour.set(n, 'gray')
		stack.push(n)
		// Lazily fetch deps for non-candidate nodes by parsing their bodies.
		let deps = depsByNumber.get(n)
		if (deps === undefined) {
			try {
				const { stdout } = await exec('gh', ['issue', 'view', String(n), '--json', 'body'])
				deps = parseDeps((JSON.parse(stdout) as { body: string }).body ?? '')
			} catch {
				deps = []
			}
			depsByNumber.set(n, deps)
		}
		for (const d of deps) {
			const found = await visit(d)
			if (found !== null) return found
		}
		stack.pop()
		colour.set(n, 'black')
		return null
	}

	for (const c of candidates) {
		const found = await visit(c.number)
		if (found !== null) return found
	}
	return null
}

async function filterByDeps(candidates: CandidateIssue[]): Promise<CandidateIssue[]> {
	const stateCache = new Map<number, IssueState | null>()
	const depsByNumber = new Map<number, number[]>()
	for (const c of candidates) depsByNumber.set(c.number, parseDeps(c.body))

	// Pass 1: resolve every directly-referenced number and batch missing-ref
	// errors so the maintainer learns about every typo in one shot.
	const referenced = new Set<number>()
	for (const deps of depsByNumber.values()) for (const n of deps) referenced.add(n)

	const missing: Array<{ source: number; bad: number }> = []
	for (const c of candidates) {
		for (const dep of depsByNumber.get(c.number)!) {
			const state = await getIssueState(stateCache, dep)
			if (state === null) missing.push({ source: c.number, bad: dep })
		}
	}
	if (missing.length > 0) {
		const lines = missing.map(
			(m) => `  · Issue #${m.source} declares "Depends on #${m.bad}" but #${m.bad} does not exist in this repo`,
		)
		throw new Error(
			`Dependency declarations reference missing issues:\n${lines.join('\n')}\n\nFix or remove the trailers, then re-run.`,
		)
	}

	// Pass 2: cycle detection across the reachable open subgraph.
	const cycle = await findCycle(candidates, depsByNumber, stateCache)
	if (cycle !== null) {
		throw new Error(
			`Dependency cycle detected: ${cycle.map((n) => `#${n}`).join(' → ')}.\n` +
				`At least one dep declaration is wrong. Edit one of the issues to break the cycle, then re-run.`,
		)
	}

	// Pass 3: filter — an issue is unblocked iff every direct dep is CLOSED.
	const survivors: CandidateIssue[] = []
	for (const c of candidates) {
		const deps = depsByNumber.get(c.number)!
		const openDeps: number[] = []
		for (const dep of deps) {
			const state = await getIssueState(stateCache, dep)
			if (state === 'OPEN') openDeps.push(dep)
		}
		if (openDeps.length === 0) {
			survivors.push(c)
		} else {
			console.log(`  · #${c.number} blocked by ${openDeps.map((n) => `#${n}`).join(', ')} (open) — skipping`)
		}
	}
	return survivors
}

async function ensureLinkedIssueBranch(issueId: string, issueBranch: string, featureBranch: string) {
	// Make sure we have the latest feature-branch tip locally.
	await exec('git', ['fetch', 'origin', featureBranch])

	// If the issue branch doesn't yet exist on origin, create it via
	// `gh issue develop` — this both creates the branch on the remote off the
	// feature branch AND links it to the issue (visible in the issue's
	// "Development" sidebar). On re-runs the branch already exists; we leave it
	// alone so prior progress is preserved.
	if (!(await remoteBranchExists(issueBranch))) {
		console.log(`  → Creating linked branch ${issueBranch} for issue #${issueId}`)
		await exec('gh', ['issue', 'develop', issueId, '--name', issueBranch, '--base', featureBranch])
		// Fetch the freshly-created remote ref so we can build a local branch on top.
		await exec('git', ['fetch', 'origin', issueBranch])
	}

	// Ensure a local branch exists tracking the remote.
	try {
		await exec('git', ['rev-parse', '--verify', `refs/heads/${issueBranch}`])
	} catch {
		await exec('git', ['branch', issueBranch, `origin/${issueBranch}`])
	}
}

async function getPRsNeedingFeedback(): Promise<FeedbackPR[]> {
	// Fetch the latest refs so local branches the agent will check out
	// match what humans see on GitHub.
	await exec('git', ['fetch', '--all', '--prune'])

	// We use a label as the trigger because GitHub doesn't let PR authors
	// request changes on their own PR. The human reviewer adds
	// `needs-revision` after leaving comments; the addresser removes it once
	// it pushes a fix.
	const { stdout } = await exec('gh', [
		'pr',
		'list',
		'--state',
		'open',
		'--label',
		NEEDS_REVISION_LABEL,
		'--limit',
		'100',
		'--json',
		'number,title,url,headRefName,baseRefName',
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
	await exec('git', ['push', '-u', 'origin', issue.branch])

	console.log(`  → Opening PR for issue #${issue.id} → ${issue.featureBranch}`)
	const { stdout } = await exec('gh', [
		'pr',
		'create',
		'--head',
		issue.branch,
		'--base',
		issue.featureBranch,
		'--title',
		`Sandcastle: ${issue.title} (#${issue.id})`,
		'--body',
		[
			`Automated implementation by Sandcastle for issue #${issue.id}.`,
			'',
			`Closes #${issue.id}`,
			'',
			`_Awaiting human review and approval. This PR targets the long-lived feature branch \`${issue.featureBranch}\`._`,
		].join('\n'),
	])
	const url = stdout.trim()
	console.log(`  → PR opened: ${url}`)

	// Explicitly create the issue↔PR link via the `linkPullRequest` GraphQL
	// mutation. `gh issue develop` linked the *branch*, and `Closes #N` in the
	// body declares intent — but neither guarantees the formal "Linked pull
	// requests" entry on the issue. We make the link explicit so the issue UI
	// shows the PR consistently and GitHub's native auto-close fires when the
	// feature branch eventually lands in `main`.
	const prNumber = url.split('/').pop()!
	const [{ stdout: prIdRaw }, { stdout: issueIdRaw }] = await Promise.all([
		exec('gh', ['pr', 'view', prNumber, '--json', 'id', '--jq', '.id']),
		exec('gh', ['issue', 'view', issue.id, '--json', 'id', '--jq', '.id']),
	])
	try {
		await exec('gh', [
			'api', 'graphql',
			'-f', 'query=mutation($issueId: ID!, $prId: ID!) { linkPullRequest(input: { issueId: $issueId, pullRequestId: $prId }) { clientMutationId } }',
			'-f', `issueId=${issueIdRaw.trim()}`,
			'-f', `prId=${prIdRaw.trim()}`,
		])
	} catch (err) {
		// Most common cause: GitHub already auto-linked the PR off the
		// `gh issue develop` branch, so the mutation errors with "already
		// linked". That's fine — log and move on.
		console.log(`  · linkPullRequest skipped: ${(err as Error).message.split('\n')[0]}`)
	}

	// Hit the REST API directly instead of `gh issue edit --add-label` because
	// the latter goes through a GraphQL path that touches the deprecated
	// `projectCards` field and fails on repos with Projects (classic) sunset.
	await exec('gh', ['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${issue.id}/labels`, '-f', `labels[]=${IN_PR_LABEL}`])
}

async function pushFeedbackBranch(pr: FeedbackPR) {
	console.log(`  → Pushing ${pr.branch} (PR #${pr.number})`)
	await exec('git', ['push', 'origin', pr.branch])
	// Hand the ball back to the human reviewer — they re-apply the label if
	// they want another pass.
	//
	// We hit `gh api` directly instead of `gh pr edit --remove-label` because
	// `gh pr edit` issues a GraphQL query that touches the deprecated
	// `repository.pullRequest.projectCards` field and fails outright on repos
	// where Projects (classic) has been sunset. The REST labels endpoint takes
	// a clean DELETE and isn't affected.
	await exec('gh', ['api', '--method', 'DELETE', `repos/{owner}/{repo}/issues/${pr.number}/labels/${NEEDS_REVISION_LABEL}`])
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
			agent: sandcastle.claudeCode('claude-opus-4-6'),
			promptFile: './.sandcastle/respond-to-feedback-prompt.md',
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
			name: 'implementer',
			maxIterations: 100,
			agent: sandcastle.claudeCode('claude-opus-4-6'),
			promptFile: './.sandcastle/implement-prompt.md',
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
			name: 'reviewer',
			maxIterations: 1,
			agent: sandcastle.claudeCode('claude-opus-4-6'),
			promptFile: './.sandcastle/review-prompt.md',
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
			if (outcome.status === 'rejected') {
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
		console.log('No open PRs need feedback addressed.')
	}

	// Phase 1: Plan new work (scoped to FEATURE)
	//
	// Step 1a — host fetches candidates and applies the deterministic dep
	// filter. `Depends on #N` / `Blocked by #N` trailers are parsed from issue
	// bodies; missing refs and cycles hard-fail the iteration. The surviving
	// subset is then handed to the planner.
	console.log('Fetching candidate issues…')
	const candidates = await fetchCandidates(FEATURE)
	if (candidates.length === 0) {
		console.log('No candidate issues for this feature.')
		if (feedbackPRs.length === 0) {
			console.log('Queue empty. Exiting.')
			break
		}
		continue
	}

	console.log(`Filtering ${candidates.length} candidate(s) by deps…`)
	const survivors = await filterByDeps(candidates)
	if (survivors.length === 0) {
		console.log('All candidates blocked by deps; nothing to plan this iteration.')
		if (feedbackPRs.length === 0) {
			console.log('Queue empty. Exiting.')
			break
		}
		continue
	}
	console.log(`Surviving: ${survivors.length} candidate(s)`)

	// Step 1b — invoke the planner on the pre-filtered subset.
	const plan = await sandcastle.run({
		hooks,
		sandbox: docker(),
		name: 'planner',
		maxIterations: 1,
		agent: sandcastle.claudeCode('claude-opus-4-6'),
		promptFile: './.sandcastle/plan-prompt.md',
		promptArgs: {
			FEATURE,
			ISSUES_JSON: JSON.stringify(
				survivors.map((s) => ({
					number: s.number,
					title: s.title,
					body: s.body,
					labels: s.labels,
					comments: s.comments,
				})),
			),
		},
	})

	const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/)
	if (!planMatch) {
		throw new Error('Planning agent did not produce a <plan> tag.\n\n' + plan.stdout)
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
				`Issue #${raw.id} ("${raw.title}") has multiple \`feature/*\` labels: ${raw.featureLabels.join(', ')}. ` +
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
		console.log('No unblocked issues to work on.')
		// If there was also no feedback work this iteration, the queue is empty.
		if (feedbackPRs.length === 0) {
			console.log('Queue empty. Exiting.')
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
		if (outcome.status === 'rejected') {
			console.error(`  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`)
		}
	}

	// Phase 3: Publish — push branches and open PRs
	const completed = settled
		.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
		.filter((v) => v.commits.length > 0)

	if (completed.length === 0) {
		console.log('No commits produced. Nothing to publish.')
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

console.log('\nAll done.')
