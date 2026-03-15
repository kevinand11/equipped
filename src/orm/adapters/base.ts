import type { QueryAST } from '../query'
import type { AnySchema } from '../schema'

export type RepoConfig = object

export type InsertOptions = {
	getTime?: () => Date
}

export type UpdateOptions = {
	getTime?: () => Date
}

export type UpsertOptions = {
	getTime?: () => Date
}

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
	findMany: (queryAst: QueryAST) => Promise<Record<string, unknown>[]>
	findOne: (queryAst: QueryAST) => Promise<Record<string, unknown> | null>
	insertOne: (data: Record<string, unknown>, options?: InsertOptions) => Promise<Record<string, unknown>>
	insertMany: (data: Record<string, unknown>[], options?: InsertOptions) => Promise<Record<string, unknown>[]>
	updateMany: (queryAst: QueryAST, data: Record<string, unknown>, options?: UpdateOptions) => Promise<Record<string, unknown>[]>
	updateOne: (queryAst: QueryAST, data: Record<string, unknown>, options?: UpdateOptions) => Promise<Record<string, unknown> | null>
	upsertOne: (
		queryAst: QueryAST,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	) => Promise<Record<string, unknown>>
	deleteOne: (queryAst: QueryAST) => Promise<Record<string, unknown> | null>
	deleteMany: (queryAst: QueryAST) => Promise<Record<string, unknown>[]>
	query: (
		queryAst: QueryAST,
		pagination: { page: number; limit: number; all: boolean },
	) => Promise<PaginatedResult<Record<string, unknown>>>
}

export abstract class Orm<R extends RepoConfig = RepoConfig> {
	abstract connect(): Promise<void>

	abstract disconnect(): Promise<void>

	abstract use(schema: AnySchema<any, any, any, any>, config: R): OrmUse

	abstract session<R>(callback: () => Promise<R>): Promise<R>
}
