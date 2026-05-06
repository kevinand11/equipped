import type { FilterGroup } from '../filter'
import type { QueryOptions } from '../query'
import type { AnySchema } from '../schema'
import type { AnyUpdateOp } from '../updates'

export type OrmUse = {
	findMany: (filter: FilterGroup, options?: QueryOptions) => Promise<Record<string, unknown>[]>
	findOne: (filter: FilterGroup) => Promise<Record<string, unknown> | null>
	createOne: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
	createMany: (data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>
	updateMany: (filter: FilterGroup, data: Record<string, unknown>) => Promise<Record<string, unknown>[]>
	updateOne: (filter: FilterGroup, data: Record<string, unknown>) => Promise<Record<string, unknown> | null>
	upsertOne: (
		filter: FilterGroup,
		create: Record<string, unknown>,
		ops: AnyUpdateOp[],
	) => Promise<Record<string, unknown>>
	deleteOne: (filter: FilterGroup) => Promise<Record<string, unknown> | null>
	deleteMany: (filter: FilterGroup) => Promise<Record<string, unknown>[]>
	raw: (...args: any[]) => Promise<any>
}

export type OrmAdapterLike<Config extends object = object> = {
	connect(): Promise<void>
	disconnect(): Promise<void>
	use(schema: AnySchema, config: Config): OrmUse
	session<T>(fn: () => Promise<T>): Promise<T>
}

export type OrmAdapterConfig<Adapter extends OrmAdapterLike<any>> = Adapter extends OrmAdapterLike<infer Config> ? Config : never