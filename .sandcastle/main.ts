// Sandcastle orchestration loop — see docs/agents/sandcastle.md for design.
//
// Per-iteration shape: fetch PRD sub-issues with `ready-for-agent` → classify
// each from origin state → run a per-issue end-to-end coroutine concurrently.
// No batch barriers. Origin (PR existence + draft state + branch ahead-count)
// is the source of truth.
//
// Usage:
//   npx tsx .sandcastle/main.ts <prd-issue-number>

import { classify, fetchCandidates } from './utils/candidates.ts'
import { FEATURE_BRANCH, MAX_ITERATIONS, PRD_NUMBER } from './utils/config.ts'
import { filterByDeps } from './utils/deps.ts'
import { remoteBranchExists } from './utils/git.ts'
import { processIssue } from './utils/process.ts'
import { exec } from './utils/shell.ts'
import type { Candidate } from './utils/types.ts'

console.log(`Sandcastle scoped to PRD #${PRD_NUMBER} (integration branch: ${FEATURE_BRANCH})`)

if (!(await remoteBranchExists(FEATURE_BRANCH))) {
	console.log(`Integration branch ${FEATURE_BRANCH} missing — creating off main and linking to PRD #${PRD_NUMBER}`)
	await exec('gh', ['issue', 'develop', String(PRD_NUMBER), '--name', FEATURE_BRANCH, '--base', 'main'])
	await exec('git', ['fetch', 'origin', FEATURE_BRANCH])
}

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
	console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} (PRD #${PRD_NUMBER}) ===\n`)

	// Re-fetch the integration tip so classification sees current state.
	await exec('git', ['fetch', 'origin', FEATURE_BRANCH])

	console.log('Fetching candidate issues…')
	const candidates = await fetchCandidates(PRD_NUMBER)
	if (candidates.length === 0) {
		console.log('No candidate sub-issues for this PRD. Exiting.')
		break
	}

	console.log(`Classifying ${candidates.length} candidate(s)…`)
	const classified = await Promise.all(
		candidates.map(async (c) => ({ c, s: await classify(c) })),
	)

	const inFlight = classified
		.filter((x) => x.s.kind !== 'implement' && x.s.kind !== 'done')
		.map((x) => x.c)
	const fresh = classified.filter((x) => x.s.kind === 'implement').map((x) => x.c)
	const doneCount = classified.filter((x) => x.s.kind === 'done').length
	console.log(`  · ${doneCount} done · ${inFlight.length} in-flight · ${fresh.length} fresh`)

	let freshUnblocked: Candidate[] = []
	if (fresh.length > 0) {
		console.log(`Filtering ${fresh.length} fresh candidate(s) by deps…`)
		freshUnblocked = await filterByDeps(fresh, candidates)
		console.log(`  · ${freshUnblocked.length} fresh unblocked`)
	}

	const toProcess = [...inFlight, ...freshUnblocked]
	if (toProcess.length === 0) {
		console.log('Queue empty. Exiting.')
		break
	}

	console.log(`Processing ${toProcess.length} issue(s) concurrently:`)
	for (const issue of toProcess) {
		console.log(`  · #${issue.number}: ${issue.title}`)
	}

	const settled = await Promise.allSettled(toProcess.map(processIssue))
	for (const [i, outcome] of settled.entries()) {
		const candidate = toProcess[i]!
		if (outcome.status === 'rejected') {
			console.error(`  ✗ #${candidate.number} failed: ${outcome.reason}`)
		} else {
			console.log(`  ✓ #${candidate.number}: ${outcome.value}`)
		}
	}
}

console.log('\nAll done.')
