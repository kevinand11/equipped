import { ClassPropertiesWrapper } from 'valleyed'

export { DeepOmit } from 'valleyed'

export type EnumToStringUnion<T extends Record<string, string | number>> = `${T[keyof T]}`

export type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }

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

export class BaseEntity<Keys extends object, Ignored extends string> extends ClassPropertiesWrapper<Keys, Ignored> {}