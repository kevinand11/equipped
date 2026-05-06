import { FEATURE_BRANCH } from './config.ts'
import { exec } from './shell.ts'
import type { Candidate } from './types.ts'

function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '')
	return slug || 'untitled'
}

// Look up branches the issue is already linked to via the GitHub
// "Development" sidebar (set by `gh issue develop --name`). Returns the first
// linked branch, or null if none exists. Multiple linked branches indicate
// legacy or human-introduced state; warn but pick the first.
export async function lookupLinkedBranch(issueNumber: number): Promise<string | null> {
	try {
		const { stdout } = await exec('gh', ['issue', 'develop', '--list', String(issueNumber)])
		const branches = stdout
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((line) => line.split('\t')[0]!.trim())
			.filter(Boolean)
		if (branches.length === 0) return null
		if (branches.length > 1) {
			console.warn(`  ⚠ #${issueNumber} has multiple linked branches: ${branches.join(', ')}; using ${branches[0]}`)
		}
		return branches[0]!
	} catch {
		return null
	}
}

// Returns the branch to work on for this issue. If a linked branch exists,
// reuse it. Otherwise create a fresh `sandcastle/issue-<N>-<slug>` linked to
// the issue via `gh issue develop`.
export async function getOrCreateIssueBranch(candidate: Candidate): Promise<string> {
	const linked = await lookupLinkedBranch(candidate.number)
	if (linked) {
		try {
			await exec('git', ['rev-parse', '--verify', `refs/heads/${linked}`])
		} catch {
			await exec('git', ['fetch', 'origin', linked])
			await exec('git', ['branch', linked, `origin/${linked}`])
		}
		return linked
	}

	const branch = `sandcastle/issue-${candidate.number}-${slugify(candidate.title)}`
	console.log(`  → Creating linked branch ${branch} for issue #${candidate.number}`)
	await exec('git', ['fetch', 'origin', FEATURE_BRANCH])
	await exec('gh', ['issue', 'develop', String(candidate.number), '--name', branch, '--base', FEATURE_BRANCH])
	await exec('git', ['fetch', 'origin', branch])
	return branch
}
