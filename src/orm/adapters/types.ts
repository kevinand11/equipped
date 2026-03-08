import type { QueryAST } from '../query/types'
import type { Schema } from '../schema/types'

export type BaseTableConfig = {
	primaryKey: string
}

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

export interface Adapter<T extends BaseTableConfig = BaseTableConfig> {
	connect(): Promise<void>

	disconnect(): Promise<void>

	findMany(schema: Schema<any, any, any, any>, table: T, queryAst: QueryAST): Promise<Record<string, unknown>[]>

	findOne(schema: Schema<any, any, any, any>, table: T, queryAst: QueryAST): Promise<Record<string, unknown> | null>

	insertOne(
		schema: Schema<any, any, any, any>,
		table: T,
		data: Record<string, unknown>,
		options?: InsertOptions,
	): Promise<Record<string, unknown>>

	insertMany(
		schema: Schema<any, any, any, any>,
		table: T,
		data: Record<string, unknown>[],
		options?: InsertOptions,
	): Promise<Record<string, unknown>[]>

	updateMany(
		schema: Schema<any, any, any, any>,
		table: T,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown>[]>

	updateOne(
		schema: Schema<any, any, any, any>,
		table: T,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown> | null>

	upsertOne(
		schema: Schema<any, any, any, any>,
		table: T,
		queryAst: QueryAST,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	): Promise<Record<string, unknown>>

	deleteOne(schema: Schema<any, any, any, any>, table: T, queryAst: QueryAST): Promise<Record<string, unknown> | null>

	deleteMany(schema: Schema<any, any, any, any>, table: T, queryAst: QueryAST): Promise<Record<string, unknown>[]>

	count(schema: Schema<any, any, any, any>, table: T, queryAst: QueryAST): Promise<number>

	session<R>(callback: () => Promise<R>): Promise<R>

	query(
		schema: Schema<any, any, any, any>,
		table: T,
		queryAst: QueryAST,
		pagination: { page: number; limit: number; all: boolean },
	): Promise<PaginatedResult<Record<string, unknown>>>
}
