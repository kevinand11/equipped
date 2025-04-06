type Rc<T> = T

export const DefaultAuthRole = {} as const
export interface IAuthRole extends Rc<typeof DefaultAuthRole> {}

export const DefaultAuthTypes = {
	google: 'google',
	apple: 'apple',
	email: 'email',
	facebook: 'facebook',
	twitter: 'twitter',
	github: 'github',
} as const
export interface IAuthTypes extends Rc<typeof DefaultAuthTypes> {}

export const DefaultEmailsList = {} as const
export interface IEmailsList extends Rc<typeof DefaultEmailsList> {}

export const DefaultEventTypes = {} as const
export interface IEventTypes extends Rc<typeof DefaultEventTypes> {}

export const DefaultDelayedJobs = {} as const
export interface IDelayedJobs extends Rc<typeof DefaultDelayedJobs> {}

export const DefaultCronLikeJobs = {} as const
export interface ICronLikeJobs extends Rc<typeof DefaultCronLikeJobs> {}

export const DefaultCronTypes = {
	hourly: 'hourly',
	daily: 'daily',
	weekly: 'weekly',
	monthly: 'monthly',
} as const
export interface ICronTypes extends Rc<typeof DefaultCronTypes> {}

export type Enum<T> = T[keyof T]
