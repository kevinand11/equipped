import type { CronTypes, DelayedJobs, RepeatableJobs } from '../../types'

export enum JobNames {
	CronJob = 'CronJob',
	RepeatableJob = 'RepeatableJob',
	DelayedJob = 'DelayedJob',
}

export type Cron = CronTypes[keyof CronTypes]
export type DelayedJobEvent = DelayedJobs[keyof DelayedJobs]
export type RepeatableJobEvent = RepeatableJobs[keyof RepeatableJobs]
export type DelayedJobCallback = (data: DelayedJobEvent) => Promise<void> | void
export type CronJobCallback = (name: CronTypes[keyof CronTypes]) => Promise<void> | void
export type RepeatableJobCallback = (data: RepeatableJobEvent) => Promise<void> | void
export type JobCallbacks = { onDelayed?: DelayedJobCallback; onCron?: CronJobCallback; onRepeatable?: RepeatableJobCallback }

export type Job = {
	crons: { name: Cron; cron: string }[]
	callbacks: JobCallbacks
	addDelayed: (data: DelayedJobEvent, delayInMs: number) => Promise<string>
	addRepeatable: (data: RepeatableJobEvent, cron: string, tz?: string) => Promise<string>
	removeDelayed: (jobId: string) => Promise<void>
	retryAllFailedJobs: () => Promise<void>
}
