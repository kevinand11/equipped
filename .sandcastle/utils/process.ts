import { getOrCreateIssueBranch } from './branches.ts'
import { classify } from './candidates.ts'
import {
	ADDRESSER_MAX_ITERATIONS,
	IMPLEMENTER_MAX_ITERATIONS,
	ISSUE_STEP_CAP,
	NEEDS_REVISION_LABEL,
	READY_FOR_AGENT_LABEL,
	REVIEWER_MAX_ITERATIONS,
} from './config.ts'
import {
	ghCreateDraftPr,
	ghMarkReady,
	ghRemoveLabel,
	preflightAddresserDirective,
	preflightImplementerDirective,
	preflightReviewerDirective,
} from './gh.ts'
import { pushBranch } from './git.ts'
import {
	exitedCleanly,
	runAddresserInFreshSandbox,
	runImplementerInFreshSandbox,
	runReviewerInFreshSandbox,
} from './sandbox.ts'
import type { Candidate, ProcessOutcome } from './types.ts'

export async function processIssue(candidate: Candidate): Promise<ProcessOutcome> {
	const tag = `#${candidate.number}`
	for (let step = 0; step < ISSUE_STEP_CAP; step++) {
		const state = await classify(candidate)

		switch (state.kind) {
			case 'done':
				console.log(`  · ${tag} done`)
				return 'done'

			case 'implement': {
				const branch = await getOrCreateIssueBranch(candidate)
				console.log(`  → ${tag} implementer starting on ${branch}`)
				const result = await runImplementerInFreshSandbox(candidate, branch)
				if (result.commits.length === 0) {
					if (exitedCleanly(result, IMPLEMENTER_MAX_ITERATIONS)) {
						console.log(`  · ${tag} implementer made no commits; removing ${READY_FOR_AGENT_LABEL}`)
						await ghRemoveLabel(candidate.number, READY_FOR_AGENT_LABEL)
						return 'no-work'
					}
					console.log(`  · ${tag} implementer hit cap with no commits; will retry next run`)
					return 'partial'
				}
				if (!(await preflightImplementerDirective(candidate.number))) return 'partial'
				await pushBranch(branch)
				await ghCreateDraftPr(candidate, branch)
				continue
			}

			case 'create-pr-then-review':
				console.log(`  → ${tag} self-heal: creating draft PR for ${state.branch}`)
				await ghCreateDraftPr(candidate, state.branch)
				continue

			case 'review': {
				console.log(`  → ${tag} reviewer starting on ${state.branch} (PR #${state.prNumber})`)
				const result = await runReviewerInFreshSandbox(candidate, state.branch)
				if (result.commits.length > 0) {
					if (!(await preflightReviewerDirective(state.prNumber))) return 'partial'
					await pushBranch(state.branch)
				}
				if (!exitedCleanly(result, REVIEWER_MAX_ITERATIONS)) {
					console.log(`  · ${tag} reviewer hit cap; will retry next run`)
					return 'partial'
				}
				await ghMarkReady(state.prNumber)
				continue
			}

			case 'address': {
				console.log(`  → ${tag} addresser starting on ${state.branch} (PR #${state.prNumber})`)
				const result = await runAddresserInFreshSandbox(candidate, state.branch, state.prNumber)
				if (result.commits.length === 0) {
					if (exitedCleanly(result, ADDRESSER_MAX_ITERATIONS)) {
						console.log(`  · ${tag} addresser made no commits; removing ${NEEDS_REVISION_LABEL}`)
						await ghRemoveLabel(state.prNumber, NEEDS_REVISION_LABEL)
						return 'no-work'
					}
					console.log(`  · ${tag} addresser hit cap with no commits; will retry next run`)
					return 'partial'
				}
				if (!(await preflightAddresserDirective(state.prNumber))) return 'partial'
				await pushBranch(state.branch)
				await ghRemoveLabel(state.prNumber, NEEDS_REVISION_LABEL)
				continue
			}
		}
	}
	console.warn(`  ⚠ ${tag} step-cap reached; leaving in current state`)
	return 'partial'
}
