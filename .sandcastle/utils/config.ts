import { Command, InvalidArgumentError } from 'commander'

const parsePositiveInt = (raw: string): number => {
	const n = Number.parseInt(raw, 10)
	if (!Number.isFinite(n) || n < 1) {
		throw new InvalidArgumentError(`must be a positive integer (got '${raw}')`)
	}
	return n
}

const program = new Command()
	.name('sandcastle')
	.description(
		'Run the Sandcastle parallel-planner-with-review loop scoped to a single PRD (parent issue). Multiple devs can run scoped loops for different PRDs in parallel.',
	)
	.argument('<prd-issue-number>', "PRD parent issue number (e.g. '27'). Discovery walks its sub-issues.", parsePositiveInt)
	.option('-b, --integration-branch <branch>', 'integration branch to target with slice PRs (defaults to `prds-issue-<prd-number>`)')
	.option('-m, --max-iterations <n>', 'maximum number of plan/execute/publish cycles per run', parsePositiveInt, 1)
	.parse()

export const PRD_NUMBER: number = program.processedArgs[0]
export const FEATURE_BRANCH: string = program.opts().integrationBranch ?? `prds-issue-${PRD_NUMBER}`
export const MAX_ITERATIONS: number = program.opts().maxIterations

export const READY_FOR_AGENT_LABEL = 'ready-for-agent'
export const NEEDS_REVISION_LABEL = 'needs-revision'

export const IMPLEMENTER_MAX_ITERATIONS = 100
export const REVIEWER_MAX_ITERATIONS = 1
export const ADDRESSER_MAX_ITERATIONS = 50

export const ISSUE_STEP_CAP = 5

// `pnpm install --prefer-offline` matches this repo's package manager and
// reuses cached/host-copied node_modules wherever possible. The default
// 60s hook timeout is too short for a clean install on a non-trivial repo —
// bump it generously.
export const hooks = {
	sandbox: {
		onSandboxReady: [{ command: 'pnpm install --prefer-offline', timeoutMs: 600_000 }],
	},
}

export const copyToWorktree = ['node_modules']
