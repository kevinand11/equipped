export interface CronTypes {}

export interface Events extends Record<never, { topic: unknown; data: unknown }> {}

export interface DelayedJobs extends Record<never, { type: unknown; data: unknown }> {}
export interface RepeatableJobs extends Record<never, { type: unknown; data: unknown }> {}

export interface RefreshUser {
	id: string
}

export interface AuthUser {
	id: string
}
