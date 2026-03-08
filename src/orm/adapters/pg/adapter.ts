import { AsyncLocalStorage } from 'node:async_hooks'

import type { QueryAST } from '../../query/types'
import type { Schema } from '../../schema/types'
import type { Adapter, InsertOptions, PaginatedResult, UpdateOptions, UpsertOptions } from '../types'
import { buildCountQuery, buildDeleteQuery, buildInsertQuery, buildSelectQuery, buildUpdateQuery } from './query-compiler'

const sessionStore = new AsyncLocalStorage<PgClient | undefined>()

export type PgAdapterConfig = {
	pool: PgPool
}

export type PgTableConfig = {
	schema?: string
	table: string
	primaryKey: string
}

export interface PgPool {
	query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface PgClient extends PgPool {
	query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export class PgAdapter implements Adapter<PgTableConfig> {
	private pool: PgPool

	constructor(config: PgAdapterConfig) {
		this.pool = config.pool
	}

	async connect(): Promise<void> {}

	async disconnect(): Promise<void> {}

	private getClient(): PgPool {
		return sessionStore.getStore() ?? this.pool
	}

	private getTableName(table: PgTableConfig): string {
		if (table.schema && table.schema !== 'public') return `${table.schema}.${table.table}`
		return table.table
	}

	async findMany(_schema: Schema, table: PgTableConfig, queryAst: QueryAST): Promise<Record<string, unknown>[]> {
		const tableName = this.getTableName(table)
		const { sql, params } = buildSelectQuery(queryAst, tableName, table.primaryKey)
		const result = await this.getClient().query(sql, params)
		return result.rows
	}

	async findOne(schema: Schema, table: PgTableConfig, queryAst: QueryAST): Promise<Record<string, unknown> | null> {
		const limitedAst = { ...queryAst, limit: 1 }
		const results = await this.findMany(schema, table, limitedAst)
		return results[0] ?? null
	}

	async insertOne(
		schema: Schema,
		table: PgTableConfig,
		data: Record<string, unknown>,
		options?: InsertOptions,
	): Promise<Record<string, unknown>> {
		const results = await this.insertMany(schema, table, [data], options)
		return results[0]
	}

	async insertMany(
		schema: Schema,
		table: PgTableConfig,
		data: Record<string, unknown>[],
		options?: InsertOptions,
	): Promise<Record<string, unknown>[]> {
		const tableName = this.getTableName(table)
		const now = options?.getTime?.() ?? new Date()
		const client = this.getClient()

		const results: Record<string, unknown>[] = []

		for (let i = 0; i < data.length; i++) {
			const id = schema.generateId(i)
			const doc = {
				...data[i],
				[table.primaryKey]: id,
				createdAt: now.getTime(),
				updatedAt: now.getTime(),
			}

			const { sql, params } = buildInsertQuery(tableName, doc)
			const result = await client.query(sql, params)
			results.push(result.rows[0])
		}

		return results
	}

	async updateMany(
		_schema: Schema,
		table: PgTableConfig,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown>[]> {
		const tableName = this.getTableName(table)
		const now = options?.getTime?.() ?? new Date()
		const fullData = { ...data, updatedAt: now.getTime() }

		const { sql, params } = buildUpdateQuery(queryAst, tableName, table.primaryKey, fullData)
		const result = await this.getClient().query(sql, params)
		return result.rows
	}

	async updateOne(
		schema: Schema,
		table: PgTableConfig,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown> | null> {
		const limitedAst = { ...queryAst, limit: 1 }
		const results = await this.updateMany(schema, table, limitedAst, data, options)
		return results[0] ?? null
	}

	async upsertOne(
		schema: Schema,
		table: PgTableConfig,
		_queryAst: QueryAST,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	): Promise<Record<string, unknown>> {
		const tableName = this.getTableName(table)
		const now = options?.getTime?.() ?? new Date()
		const id = schema.generateId(0)
		const client = this.getClient()

		const insertData = {
			...data.insert,
			[table.primaryKey]: id,
			createdAt: now.getTime(),
			updatedAt: now.getTime(),
		}

		const updateData = 'update' in data ? data.update : data.insert
		const updateDataWithTime = { ...updateData, updatedAt: now.getTime() }

		const columns = Object.keys(insertData)
		const values = Object.values(insertData)
		const placeholders = columns.map((_, i) => `$${i + 1}`)

		const updateParts = Object.keys(updateDataWithTime).map((key) => {
			values.push(updateDataWithTime[key])
			return `"${key}" = $${values.length}`
		})

		const sql = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')})
			VALUES (${placeholders.join(', ')})
			ON CONFLICT ("${table.primaryKey}") DO UPDATE SET ${updateParts.join(', ')}
			RETURNING *`.replace(/\s+/g, ' ')

		const result = await client.query(sql, values)
		return result.rows[0]
	}

	async deleteOne(schema: Schema, table: PgTableConfig, queryAst: QueryAST): Promise<Record<string, unknown> | null> {
		const limitedAst = { ...queryAst, limit: 1 }
		const results = await this.deleteMany(schema, table, limitedAst)
		return results[0] ?? null
	}

	async deleteMany(_schema: Schema, table: PgTableConfig, queryAst: QueryAST): Promise<Record<string, unknown>[]> {
		const tableName = this.getTableName(table)
		const { sql, params } = buildDeleteQuery(queryAst, tableName, table.primaryKey)
		const result = await this.getClient().query(sql, params)
		return result.rows
	}

	async count(_schema: Schema, table: PgTableConfig, queryAst: QueryAST): Promise<number> {
		const tableName = this.getTableName(table)
		const { sql, params } = buildCountQuery(queryAst, tableName, table.primaryKey)
		const result = await this.getClient().query(sql, params)
		return Number(result.rows[0]?.count ?? 0)
	}

	async session<T>(callback: () => Promise<T>): Promise<T> {
		if (sessionStore.getStore()) return callback()

		const pool = this.pool as any
		if (!pool.connect) throw new Error('Pool must support connect() for transactions')
		const client: PgClient = await pool.connect()

		try {
			await client.query('BEGIN')
			const result = await sessionStore.run(client, callback)
			await client.query('COMMIT')
			return result
		} catch (error) {
			await client.query('ROLLBACK')
			throw error
		} finally {
			;(client as any).release?.()
		}
	}

	async query(
		schema: Schema,
		table: PgTableConfig,
		queryAst: QueryAST,
		pagination: { page: number; limit: number; all: boolean },
	): Promise<PaginatedResult<Record<string, unknown>>> {
		const tableName = this.getTableName(table)
		const { whereClause, params: countParams } = (() => {
			const { sql, params } = buildCountQuery(queryAst, tableName, table.primaryKey)
			return { whereClause: sql, params }
		})()

		const countResult = await this.getClient().query(whereClause, countParams)
		const total = Number(countResult.rows[0]?.count ?? 0)

		const paginatedAst = pagination.all
			? queryAst
			: { ...queryAst, limit: pagination.limit, offset: (pagination.page - 1) * pagination.limit }

		const results = await this.findMany(schema, table, paginatedAst)

		const { page, limit: pLimit } = pagination
		const last = Math.ceil(total / pLimit) || 1
		const next = page >= last ? null : page + 1
		const previous = page <= 1 ? null : page - 1

		return {
			pages: { start: 1, last, next, previous, current: page },
			docs: { limit: pLimit, total, count: results.length },
			results,
		}
	}
}
