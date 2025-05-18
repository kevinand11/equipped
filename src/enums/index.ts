import type { ICronLikeJobs, ICronTypes, IDelayedJobs, IEventTypes } from './types'

type Keys = keyof {
	EventTypes: IEventTypes
	DelayedJobs: IDelayedJobs
	CronLikeJobs: ICronLikeJobs
	CronTypes: ICronTypes
}

export class Enums {
	static EventTypes: IEventTypes = {}
	static DelayedJobs: IDelayedJobs = {}
	static CronLikeJobs: ICronLikeJobs = {}
	static CronTypes: ICronTypes = {}

	static make<T extends Record<string, any>>(key: Keys, obj: T): Readonly<T> {
		if (Enums[key] && typeof Enums[key] === 'object') Enums[key] = Object.freeze({ ...Enums[key], ...obj }) as any
		return obj
	}
}
