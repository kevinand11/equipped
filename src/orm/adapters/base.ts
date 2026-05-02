import type { FilterGroup } from '../filter'
import type { QueryOptions } from '../query'
import type { AnySchema } from '../schema'

export type OrmUse = {
	findMany: (filter: FilterGroup, options?: QueryOptions) => Promise<Record<string, unknown>[]>
	findOne: (filter: FilterGroup) => Promise<Record<string, unknown> | null>
	insertOne: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
	insertMany: (data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>
	updateMany: (filter: FilterGroup, data: Record<string, unknown>) => Promise<Record<string, unknown>[]>
	updateOne: (filter: FilterGroup, data: Record<string, unknown>) => Promise<Record<string, unknown> | null>
	upsertOne: (
		filter: FilterGroup,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
	) => Promise<Record<string, unknown>>
	deleteOne: (filter: FilterGroup) => Promise<Record<string, unknown> | null>
	deleteMany: (filter: FilterGroup) => Promise<Record<string, unknown>[]>
	raw: <T = unknown>(command: unknown, params?: unknown[]) => Promise<T>
}

export type OrmAdapterLike<Config extends object = object> = {
	connect(): Promise<void>
	disconnect(): Promise<void>
	use(schema: AnySchema, config: Config): OrmUse
	session<T>(fn: () => Promise<T>): Promise<T>
}

