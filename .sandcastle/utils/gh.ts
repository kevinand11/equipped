import { FEATURE_BRANCH, NEEDS_REVISION_LABEL, READY_FOR_AGENT_LABEL } from './config.ts'
import { exec } from './shell.ts'
import type { Candidate } from './types.ts'

export async function ghCreateDraftPr(candidate: Candidate, branch: string): Promise<number> {
	console.log(`  → Opening draft PR for #${candidate.number} → ${FEATURE_BRANCH}`)
	const { stdout } = await exec('gh', [
		'pr', 'create',
		'--draft',
		'--head', branch,
		'--base', FEATURE_BRANCH,
		'--title', `Sandcastle: ${candidate.title} (#${candidate.number})`,
		'--body', [
			`Automated implementation by Sandcastle for issue #${candidate.number}.`,
			'',
			`Closes #${candidate.number}`,
			'',
			`_Awaiting human review and approval. This PR targets the long-lived feature branch \`${FEATURE_BRANCH}\`._`,
		].join('\n'),
	])
	const url = stdout.trim()
	console.log(`  → Draft PR opened: ${url}`)
	const m = url.match(/\/pull\/(\d+)/)
	return m ? Number.parseInt(m[1]!, 10) : 0
}

export async function ghMarkReady(prNumber: number): Promise<void> {
	console.log(`  → Marking PR #${prNumber} ready for review`)
	await exec('gh', ['pr', 'ready', String(prNumber)])
}

// Hit the REST labels endpoint directly. `gh issue/pr edit --remove-label`
// goes through a GraphQL path that touches the deprecated `projectCards`
// field and fails on repos with Projects (classic) sunset.
export async function ghRemoveLabel(targetNumber: number, label: string): Promise<void> {
	try {
		await exec('gh', [
			'api', '--method', 'DELETE',
			`repos/{owner}/{repo}/issues/${targetNumber}/labels/${label}`,
		])
	} catch (err) {
		// 404 = label already absent. Idempotent no-op.
		if (!/404/.test((err as Error).message)) throw err
	}
}

export async function preflightImplementerDirective(issueNumber: number): Promise<boolean> {
	const { stdout } = await exec('gh', ['issue', 'view', String(issueNumber), '--json', 'state,labels'])
	const fresh = JSON.parse(stdout) as { state: string; labels: Array<{ name: string }> }
	if (fresh.state !== 'OPEN') {
		console.log(`  · #${issueNumber} no longer OPEN; discarding implementer work`)
		return false
	}
	if (!fresh.labels.some((l) => l.name === READY_FOR_AGENT_LABEL)) {
		console.log(`  · #${issueNumber} no longer has ${READY_FOR_AGENT_LABEL}; discarding implementer work`)
		return false
	}
	return true
}

export async function preflightReviewerDirective(prNumber: number): Promise<boolean> {
	const { stdout } = await exec('gh', ['pr', 'view', String(prNumber), '--json', 'state,isDraft'])
	const fresh = JSON.parse(stdout) as { state: string; isDraft: boolean }
	if (fresh.state !== 'OPEN' || !fresh.isDraft) {
		console.log(`  · PR #${prNumber} no longer OPEN+draft; discarding reviewer work`)
		return false
	}
	return true
}

export async function preflightAddresserDirective(prNumber: number): Promise<boolean> {
	const { stdout } = await exec('gh', ['pr', 'view', String(prNumber), '--json', 'state,labels'])
	const fresh = JSON.parse(stdout) as { state: string; labels: Array<{ name: string }> }
	if (fresh.state !== 'OPEN') {
		console.log(`  · PR #${prNumber} no longer OPEN; discarding addresser work`)
		return false
	}
	if (!fresh.labels.some((l) => l.name === NEEDS_REVISION_LABEL)) {
		console.log(`  · PR #${prNumber} no longer has ${NEEDS_REVISION_LABEL}; discarding addresser work`)
		return false
	}
	return true
}
