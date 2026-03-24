import type { QueryFilter, QueryOptions } from '../query'
import type { AnySchema } from '../schema'

export type PaginatedResult<T> = {
	pages: {
		current: number
		start: number
		last: number
		previous: number | null
		next: number | null
	}
	docs: {
		limit: number
		total: number
		count: number
	}
	results: T[]
}

export type OrmUse = {
	findMany: (filter: QueryFilter, options?: QueryOptions) => Promise<Record<string, unknown>[]>
	findOne: (filter: QueryFilter) => Promise<Record<string, unknown> | null>
	insertOne: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
	insertMany: (data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>
	updateMany: (filter: QueryFilter, data: Record<string, unknown>) => Promise<Record<string, unknown>[]>
	updateOne: (filter: QueryFilter, data: Record<string, unknown>) => Promise<Record<string, unknown> | null>
	upsertOne: (
		filter: QueryFilter,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
	) => Promise<Record<string, unknown>>
	deleteOne: (filter: QueryFilter) => Promise<Record<string, unknown> | null>
	deleteMany: (filter: QueryFilter) => Promise<Record<string, unknown>[]>
	paginatedQuery: (
		filter: QueryFilter,
		pagination: { page: number; limit: number; all: boolean },
	) => Promise<PaginatedResult<Record<string, unknown>>>
}

export abstract class OrmAdapter<Config extends object = object> {
	abstract connect(): Promise<void>

	abstract disconnect(): Promise<void>

	abstract use(schema: AnySchema, config: Config): OrmUse

	abstract session<T>(fn: () => Promise<T>): Promise<T>
}

export type InferAdapterConfig<A> = A extends OrmAdapter<infer C> ? C : never
