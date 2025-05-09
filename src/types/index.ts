import type { BaseEntity } from '../structure'

export type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }

export type DeepOmit<T, K, A = never> = T extends any[]
	? DeepOmit<T[number], K, A>[]
	: T extends (...args: any[]) => any
		? never
		: T extends Array<infer U>
			? DeepOmit<U, K, A>[]
			: {
					[P in keyof T as P extends K | A ? never : P]: DeepOmit<
						T[P],
						K extends `${Exclude<P, symbol>}.${infer R}` ? R : never,
						A
					>
				}

export type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never

export type Defined<T> = Exclude<T, undefined>
export type Flatten<T> = T extends object ? { [K in keyof T]: Flatten<T[K]> } : T

export type IsType<A, B> = Exclude<A, B> | Exclude<B, A> extends never ? true : false
export type IsInTypeList<T, L extends any[]> = L extends [infer First, ...infer Remaining]
	? IsType<First, T> extends true
		? true
		: IsInTypeList<T, Remaining>
	: false

type StopTypes = number | string | boolean | symbol | bigint | Date
type ExcludedTypes = (...args: any[]) => any
type Dot<T extends string, U extends string> = '' extends U ? T : `${T}.${U}`
export type Paths<T, D = never> = T extends StopTypes
	? ''
	: T extends object
		? {
				[K in keyof T & string]: T[K] extends StopTypes ? K : T[K] extends ExcludedTypes ? D : K | Dot<K, Paths<T[K]>>
			}[keyof T & string]
		: T extends readonly any[]
			? Paths<T[number]>
			: D

export type JSONPrimitives = string | number | boolean | null
export type JSONValue<T> = T extends JSONPrimitives
	? T
	: T extends Array<infer U>
		? JSONValue<U>[]
		: T extends BaseEntity<infer _M, infer I>
			? JSONValue<DeepOmit<T, I, '__ignoreInJSON'>>
			: T extends Function
				? never
				: T extends object
					? {
							[K in keyof T as JSONValue<T[K]> extends never
								? never
								: JSONValue<T[K]> extends undefined
									? never
									: K]: JSONValue<T[K]>
						}
					: never
