import { exec } from './shell.ts'

export async function remoteBranchExists(branch: string): Promise<boolean> {
	try {
		await exec('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch])
		return true
	} catch {
		return false
	}
}

export async function remoteBranchAheadOf(branch: string, base: string): Promise<boolean> {
	if (!(await remoteBranchExists(branch))) return false
	await exec('git', ['fetch', 'origin', branch])
	const { stdout } = await exec('git', ['rev-list', '--count', `origin/${base}..origin/${branch}`])
	return Number.parseInt(stdout.trim(), 10) > 0
}

export async function pushBranch(branch: string): Promise<void> {
	console.log(`  → Pushing ${branch}`)
	try {
		await exec('git', ['push', '-u', 'origin', branch])
	} catch (err) {
		const msg = (err as Error).message
		if (/non-fast-forward|rejected/i.test(msg)) {
			console.warn(
				`  ⚠ Push to ${branch} rejected. Either you have a concurrent main.ts run for this PRD, or someone else pushed to this branch since this run started. Re-run main.ts to resume.`,
			)
		}
		throw err
	}
}
