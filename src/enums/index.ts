import type { IAuthRole, IAuthTypes, ICronLikeJobs, ICronTypes, IDelayedJobs, IEmailsList, IEventTypes } from './types'
import {
	DefaultAuthRole,
	DefaultAuthTypes,
	DefaultCronLikeJobs,
	DefaultCronTypes,
	DefaultDelayedJobs,
	DefaultEmailsList,
	DefaultEventTypes,
} from './types'

type Keys = keyof {
	AuthRole: IAuthRole
	AuthTypes: IAuthTypes
	EmailsList: IEmailsList
	EventTypes: IEventTypes
	DelayedJobs: IDelayedJobs
	CronLikeJobs: ICronLikeJobs
	CronTypes: ICronTypes
}

export class Enums {
	static AuthRole: IAuthRole = DefaultAuthRole as any
	static AuthTypes: IAuthTypes = DefaultAuthTypes as any
	static EmailsList: IEmailsList = DefaultEmailsList as any
	static EventTypes: IEventTypes = DefaultEventTypes as any
	static DelayedJobs: IDelayedJobs = DefaultDelayedJobs as any
	static CronLikeJobs: ICronLikeJobs = DefaultCronLikeJobs as any
	static CronTypes: ICronTypes = DefaultCronTypes as any

	static make<T extends Record<string, any>> (key: Keys, obj: T): Readonly<T> {
		if (Enums[key] && typeof Enums[key] === 'object') Enums[key] = Object.freeze({ ...Enums[key], ...obj }) as any
		return obj
	}
}
