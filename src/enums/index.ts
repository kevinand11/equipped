import {
	DefaultAuthRole, DefaultAuthTypes, DefaultCronLikeJobs, DefaultCronTypes,
	DefaultDelayedJobs, DefaultEmailsList, DefaultEventTypes, IAuthRole, IAuthTypes,
	ICronLikeJobs, ICronTypes, IDelayedJobs, IEmailsList, IEventTypes
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

export let AuthRole: IAuthRole = DefaultAuthRole as any
export let AuthTypes: IAuthTypes = DefaultAuthTypes as any
export let EmailsList: IEmailsList = DefaultEmailsList as any
export let EventTypes: IEventTypes = DefaultEventTypes as any
export let DelayedJobs: IDelayedJobs = DefaultDelayedJobs as any
export let CronLikeJobs: ICronLikeJobs = DefaultCronLikeJobs as any
export let CronTypes: ICronTypes = DefaultCronTypes as any

export const makeEnum = <T extends Record<string, any>> (key: Keys, obj: T): Readonly<T> => {
	if (key === 'AuthRole') return AuthRole = { ...AuthRole, ...obj }
	if (key === 'AuthTypes') return AuthTypes = { ...AuthTypes, ...obj }
	if (key === 'EmailsList') return EmailsList = { ...EmailsList, ...obj }
	if (key === 'EventTypes') return EventTypes = { ...EventTypes, ...obj }
	if (key === 'DelayedJobs') return DelayedJobs = { ...DelayedJobs, ...obj }
	if (key === 'CronLikeJobs') return CronLikeJobs = { ...CronLikeJobs, ...obj }
	if (key === 'CronTypes') return CronTypes = { ...CronTypes, ...obj }
	return obj
}