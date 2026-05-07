import type { Candidate } from './types.ts'

// Inline form: matches lines that *begin* with `Depends on` / `Blocked by`
// (case-insensitive). Truncate at the first sentence terminator (`.` or `;`)
// so trailing prose doesn't pull in incidental refs.
const DEPS_LINE_RE = /^[\t ]*(?:Depends on|Blocked by)\b.*$/gim
// Block form: a markdown heading consisting only of the keyword (e.g.
// `## Blocked by`). Refs are collected from each subsequent line until the
// next heading or end of body.
const DEPS_BLOCK_HEAD_RE = /^[\t ]*#+[\t ]+(?:Depends on|Blocked by)[\t ]*$/i
const HEADING_RE = /^[\t ]*#+[\t ]+\S/
// Bare `#N` not preceded by a word char or `/` — excludes cross-repo refs.
const ISSUE_REF_RE = /(?<![\w/])#(\d+)\b/g

export function parseDeps(body: string): number[] {
	const out = new Set<number>()
	const collectRefs = (line: string) => {
		const head = line.split(/[.;]/, 1)[0]!
		for (const refMatch of head.matchAll(ISSUE_REF_RE)) {
			out.add(Number.parseInt(refMatch[1]!, 10))
		}
	}
	for (const lineMatch of body.matchAll(DEPS_LINE_RE)) {
		collectRefs(lineMatch[0])
	}
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

async function findCycle(
	candidates: Candidate[],
	depsByNumber: Map<number, number[]>,
	candidatesMap: Map<number, Candidate>,
): Promise<number[] | null> {
	const colour = new Map<number, 'gray' | 'black'>()
	const stack: number[] = []

	async function visit(n: number): Promise<number[] | null> {
		if (colour.get(n) === 'black') return null
		if (colour.get(n) === 'gray') {
			const start = stack.indexOf(n)
			return [...stack.slice(start), n]
		}
		const state = candidatesMap.get(n)?.state
		if (state !== 'OPEN') {
			colour.set(n, 'black')
			return null
		}
		colour.set(n, 'gray')
		stack.push(n)
		const deps = depsByNumber.get(n) ?? []
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

export async function filterByDeps(candidates: Candidate[], allCandidates: Candidate[]): Promise<Candidate[]> {
	const candidatesMap = new Map(allCandidates.map((c) => [c.number, c]))
	const depsByNumber = new Map<number, number[]>(allCandidates.map((c) => [c.number, parseDeps(c.body)]))

	const missing: Array<{ source: number; bad: number }> = []
	for (const c of candidates) {
		for (const dep of depsByNumber.get(c.number)!) {
			const depCandidate = candidatesMap.get(dep)
			if (!depCandidate) missing.push({ source: c.number, bad: dep })
		}
	}
	if (missing.length > 0) {
		const lines = missing.map((m) => `  · Issue #${m.source} declares "Depends on #${m.bad}" but #${m.bad} does not exist in this repo`)
		throw new Error(
			`Dependency declarations reference missing issues:\n${lines.join('\n')}\n\nFix or remove the trailers, then re-run.`,
		)
	}

	const cycle = await findCycle(candidates, depsByNumber, candidatesMap)
	if (cycle !== null) {
		throw new Error(
			`Dependency cycle detected: ${cycle.map((n) => `#${n}`).join(' → ')}.\n` +
				`At least one dep declaration is wrong. Edit one of the issues to break the cycle, then re-run.`,
		)
	}

	const survivors: Candidate[] = []
	for (const c of candidates) {
		const deps = depsByNumber.get(c.number)!
		const openDeps: number[] = []
		for (const dep of deps) {
			const depCandidate = candidatesMap.get(dep)
			if (depCandidate?.state === 'OPEN') openDeps.push(dep)
		}
		if (openDeps.length === 0) {
			survivors.push(c)
		} else {
			console.log(`  · #${c.number} blocked by ${openDeps.map((n) => `#${n}`).join(', ')} (open) — skipping`)
		}
	}
	return survivors
}
