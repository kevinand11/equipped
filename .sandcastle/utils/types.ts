export type Candidate = {
	number: number
	title: string
	body: string
	labels: string[]
}

export type ResumeState =
	| { kind: 'done' }
	| { kind: 'review'; prNumber: number; branch: string }
	| { kind: 'address'; prNumber: number; branch: string }
	| { kind: 'create-pr-then-review'; branch: string }
	| { kind: 'implement' }

export type IssueState = 'OPEN' | 'CLOSED'

export type SandboxResult = {
	commits: Array<{ sha: string }>
	iterations: unknown[]
}

export type ProcessOutcome = 'done' | 'no-work' | 'partial'
