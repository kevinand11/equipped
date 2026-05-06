import { lookupLinkedBranch } from './branches.ts'
import { FEATURE_BRANCH, NEEDS_REVISION_LABEL, READY_FOR_AGENT_LABEL } from './config.ts'
import { remoteBranchAheadOf } from './git.ts'
import { exec } from './shell.ts'
import type { Candidate, ResumeState } from './types.ts'

export async function fetchCandidates(prdNumber: number): Promise<Candidate[]> {
	const { stdout: subIssuesJson } = await exec('gh', [
		'api',
		'--paginate',
		`repos/{owner}/{repo}/issues/${prdNumber}/sub_issues`,
		'--jq',
		'[.[] | {number, title, body, state, labels: [.labels[].name]}]',
	])
	const subIssues = JSON.parse(subIssuesJson) as Array<{
		number: number
		title: string
		body: string
		state: string
		labels: string[]
	}>

	return subIssues.map((s): Candidate => {
		return {
			number: s.number,
			title: s.title,
			body: s.body,
			labels: s.labels,
			state: s.state.toUpperCase() as 'OPEN' | 'CLOSED',
		}
	})
}

export async function classify(candidate: Candidate): Promise<ResumeState> {
	if (candidate.state !== 'OPEN' || !candidate.labels.includes(READY_FOR_AGENT_LABEL)) return { kind: 'done' }
	const branch = await lookupLinkedBranch(candidate.number)
	if (!branch) return { kind: 'implement' }

	const { stdout } = await exec('gh', [
		'pr',
		'list',
		'--head',
		branch,
		'--base',
		FEATURE_BRANCH,
		'--state',
		'all',
		'--json',
		'number,state,isDraft,labels',
	])
	const prs = JSON.parse(stdout) as Array<{
		number: number
		state: 'OPEN' | 'CLOSED' | 'MERGED'
		isDraft: boolean
		labels: Array<{ name: string }>
	}>

	if (prs.some((pr) => pr.state === 'MERGED')) return { kind: 'done' }

	const open = prs.filter((pr) => pr.state === 'OPEN')
	if (open.length === 1) {
		const pr = open[0]!
		if (pr.isDraft) return { kind: 'review', prNumber: pr.number, branch }
		if (pr.labels.some((l) => l.name === NEEDS_REVISION_LABEL)) {
			return { kind: 'address', prNumber: pr.number, branch }
		}
		return { kind: 'done' }
	}

	if (await remoteBranchAheadOf(branch, FEATURE_BRANCH)) {
		return { kind: 'create-pr-then-review', branch }
	}
	return { kind: 'implement' }
}
