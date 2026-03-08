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

export interface Orm<R extends RepoConfig = RepoConfig> {
	connect(): Promise<void>

	disconnect(): Promise<void>

	findMany(schema: AnySchema<any, any, any, any>, config: R, queryAst: QueryAST): Promise<Record<string, unknown>[]>

	findOne(schema: AnySchema<any, any, any, any>, config: R, queryAst: QueryAST): Promise<Record<string, unknown> | null>

	insertOne(
		schema: AnySchema<any, any, any, any>,
		config: R,
		data: Record<string, unknown>,
		options?: InsertOptions,
	): Promise<Record<string, unknown>>

	insertMany(
		schema: AnySchema<any, any, any, any>,
		config: R,
		data: Record<string, unknown>[],
		options?: InsertOptions,
	): Promise<Record<string, unknown>[]>

	updateMany(
		schema: AnySchema<any, any, any, any>,
		config: R,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown>[]>

	updateOne(
		schema: AnySchema<any, any, any, any>,
		config: R,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown> | null>

	upsertOne(
		schema: AnySchema<any, any, any, any>,
		config: R,
		queryAst: QueryAST,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	): Promise<Record<string, unknown>>

	deleteOne(schema: AnySchema<any, any, any, any>, config: R, queryAst: QueryAST): Promise<Record<string, unknown> | null>

	deleteMany(schema: AnySchema<any, any, any, any>, config: R, queryAst: QueryAST): Promise<Record<string, unknown>[]>

	session<R>(callback: () => Promise<R>): Promise<R>

	query(
		schema: AnySchema<any, any, any, any>,
		table: R,
		queryAst: QueryAST,
		pagination: { page: number; limit: number; all: boolean },
	): Promise<PaginatedResult<Record<string, unknown>>>
}
