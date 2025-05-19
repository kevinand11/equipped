export interface IEventTypes {}
export interface IDelayedJobs {}
export interface ICronLikeJobs {}
export interface ICronTypes {}

export interface Events extends Record<string, { topic: string; data: any }> {}

export interface DelayedJobs extends Record<string, { type: string; data: any }> {}
export interface CronLikeJobs extends Record<string, { type: string; data: any }> {}

export interface RefreshUser {
	id: string
}

export interface AuthUser {
	id: string
}
