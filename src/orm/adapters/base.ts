import type { QueryGroup, QueryOptions } from '../query'
import type { AnySchema } from '../schema'

export type OrmUse = {
	findMany: (filter: QueryGroup, options?: QueryOptions) => Promise<Record<string, unknown>[]>
	findOne: (filter: QueryGroup) => Promise<Record<string, unknown> | null>
	insertOne: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
	insertMany: (data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>
	updateMany: (filter: QueryGroup, data: Record<string, unknown>) => Promise<Record<string, unknown>[]>
	updateOne: (filter: QueryGroup, data: Record<string, unknown>) => Promise<Record<string, unknown> | null>
	upsertOne: (
		filter: QueryGroup,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
	) => Promise<Record<string, unknown>>
	deleteOne: (filter: QueryGroup) => Promise<Record<string, unknown> | null>
	deleteMany: (filter: QueryGroup) => Promise<Record<string, unknown>[]>
	raw: <T = unknown>(command: unknown, params?: unknown[]) => Promise<T>
}

export abstract class OrmAdapter<Config extends object = object> {
	abstract connect(): Promise<void>

	abstract disconnect(): Promise<void>

	abstract use(schema: AnySchema, config: Config): OrmUse

	abstract session<T>(fn: () => Promise<T>): Promise<T>
}

export type InferAdapterConfig<A> = A extends OrmAdapter<infer C> ? C : never
