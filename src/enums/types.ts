export interface IEventTypes {}
export interface IDelayedJobs {}
export interface ICronLikeJobs {}
export interface ICronTypes {}

export type Enum<T> = T[keyof T]
