import * as sandcastle from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'

import { SandboxRunResult } from '@ai-hero/sandcastle'
import {
	ADDRESSER_MAX_ITERATIONS,
	copyToWorktree,
	FEATURE_BRANCH,
	hooks,
	IMPLEMENTER_MAX_ITERATIONS,
	REVIEWER_MAX_ITERATIONS,
} from './config.ts'
import type { Candidate } from './types.ts'

export const exitedCleanly = (result: SandboxRunResult, capIterations: number): boolean =>
	capIterations <= 1 || result.iterations.length < capIterations

export async function runImplementerInFreshSandbox(candidate: Candidate, branch: string) {
	const sandbox = await sandcastle.createSandbox({
		branch,
		sandbox: docker(),
		hooks,
		copyToWorktree,
	})
	try {
		return await sandbox.run({
			name: `implementer-issue${candidate.number}`,
			maxIterations: IMPLEMENTER_MAX_ITERATIONS,
			agent: sandcastle.claudeCode('claude-opus-4-6'),
			promptFile: './.sandcastle/implement-prompt.md',
			promptArgs: {
				TASK_ID: String(candidate.number),
				ISSUE_TITLE: candidate.title,
				BRANCH: branch,
			},
		})
	} finally {
		await sandbox.close()
	}
}

export async function runReviewerInFreshSandbox(candidate: Candidate, branch: string) {
	const sandbox = await sandcastle.createSandbox({
		branch,
		sandbox: docker(),
		hooks,
		copyToWorktree,
	})
	try {
		return await sandbox.run({
			name: `reviewer-issue${candidate.number}`,
			maxIterations: REVIEWER_MAX_ITERATIONS,
			agent: sandcastle.claudeCode('claude-opus-4-6'),
			promptFile: './.sandcastle/review-prompt.md',
			promptArgs: {
				BRANCH: branch,
				FEATURE_BRANCH,
			},
		})
	} finally {
		await sandbox.close()
	}
}

export async function runAddresserInFreshSandbox(candidate: Candidate, branch: string, prNumber: number) {
	const sandbox = await sandcastle.createSandbox({
		branch,
		sandbox: docker(),
		hooks,
		copyToWorktree,
	})
	try {
		return await sandbox.run({
			name: `addresser-pr${prNumber}`,
			maxIterations: ADDRESSER_MAX_ITERATIONS,
			agent: sandcastle.claudeCode('claude-opus-4-6'),
			promptFile: './.sandcastle/respond-to-feedback-prompt.md',
			promptArgs: {
				PR_NUMBER: String(prNumber),
				BRANCH: branch,
			},
		})
	} finally {
		await sandbox.close()
	}
}
