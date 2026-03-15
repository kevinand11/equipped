import { AsyncLocalStorage } from 'node:async_hooks'

import { Pool, type PoolClient } from 'pg'
import { v, type PipeOutput } from 'valleyed'

import { configurable } from '../../../utilities'
import type { AnySchema } from '../../schema'
import { Orm, type OrmUse } from '../base'
import { buildCountQuery, buildDeleteQuery, buildInsertQuery, buildSelectQuery, buildUpdateQuery } from './query'

const sessionStore = new AsyncLocalStorage<PoolClient | undefined>()

export const postgresqlConfigPipe = () =>
	v.object({
		host: v.string(),
		port: v.number().pipe(v.int(), v.gt(0)),
		username: v.string(),
		password: v.string(),
		database: v.string(),
		ssl: v.defaults(v.boolean(), false),
	})

export type PostgresqlRepoConfig = {
	schema?: string
	table: string
}

export class PostgresqlOrm extends configurable(
	postgresqlConfigPipe,
	class extends Orm<PostgresqlRepoConfig> {
		#pool: Pool
		constructor(config: PipeOutput<ReturnType<typeof postgresqlConfigPipe>>) {
			super()
			this.#pool = new Pool({
				host: config.host,
				port: config.port,
				user: config.username,
				password: config.password,
				database: config.database,
				ssl: config.ssl ? { rejectUnauthorized: false } : false,
			})
		}

		#getClient() {
			return sessionStore.getStore() ?? this.#pool
		}

		async connect() {}
		async disconnect() {
			await this.#pool.end()
		}
		use(schema: AnySchema, config: PostgresqlRepoConfig) {
			const tableName = config.schema && config.schema !== 'public' ? `${config.schema}.${config.table}` : config.table
			const use: OrmUse = {
				findMany: async (queryAst) => {
					const { sql, params } = buildSelectQuery(queryAst, tableName, schema.primaryKey)
					const result = await this.#getClient().query(sql, params)
					return result.rows
				},
				findOne: async (queryAst) => {
					const results = await use.findMany({ ...queryAst, limit: 1 })
					return results[0] ?? null
				},
				insertMany: async (data, options) => {
					const now = options?.getTime?.() ?? new Date()
					const client = this.#getClient()
					const results: any[] = []
					for (let i = 0; i < data.length; i++) {
						const id = schema.generateId(i)
						const doc = {
							...data[i],
							[schema.primaryKey]: id,
							createdAt: now.getTime(),
							updatedAt: now.getTime(),
						}
						const { sql, params } = buildInsertQuery(tableName, doc)
						const result = await client.query(sql, params)
						results.push(result.rows[0])
					}
					return results
				},
				insertOne: async (data, options) => {
					const results = await use.insertMany([data], options)
					return results[0]
				},
				updateMany: async (queryAst, data, options) => {
					const now = options?.getTime?.() ?? new Date()
					const fullData = { ...data, updatedAt: now.getTime() }
					const { sql, params } = buildUpdateQuery(queryAst, tableName, schema.primaryKey, fullData)
					const result = await this.#getClient().query(sql, params)
					return result.rows
				},
				updateOne: async (queryAst, data, options) => {
					const results = await use.updateMany({ ...queryAst, limit: 1 }, data, options)
					return results[0] ?? null
				},
				upsertOne: async (_queryAst, data, options) => {
					const now = options?.getTime?.() ?? new Date()
					const id = schema.generateId(0)
					const client = this.#getClient()
					const insertData = {
						...data.insert,
						[schema.primaryKey]: id,
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
					const sql =
						`INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT ("${schema.primaryKey}") DO UPDATE SET ${updateParts.join(', ')} RETURNING *`.replace(
							/\s+/g,
							' ',
						)
					const result = await client.query(sql, values)
					return result.rows[0]
				},
				deleteMany: async (queryAst) => {
					const { sql, params } = buildDeleteQuery(queryAst, tableName, schema.primaryKey)
					const result = await this.#getClient().query(sql, params)
					return result.rows
				},
				deleteOne: async (queryAst) => {
					const results = await use.deleteMany({ ...queryAst, limit: 1 })
					return results[0] ?? null
				},
				query: async (queryAst, pagination) => {
					const { whereClause, params: countParams } = (() => {
						const { sql, params } = buildCountQuery(queryAst, tableName, schema.primaryKey)
						return { whereClause: sql, params }
					})()
					const countResult = await this.#getClient().query(whereClause, countParams)
					const total = Number(countResult.rows[0]?.count ?? 0)
					const paginatedAst = pagination.all
						? queryAst
						: { ...queryAst, limit: pagination.limit, offset: (pagination.page - 1) * pagination.limit }
					const results = await use.findMany(paginatedAst)
					const { page, limit: pLimit } = pagination
					const last = Math.ceil(total / pLimit) || 1
					const next = page >= last ? null : page + 1
					const previous = page <= 1 ? null : page - 1
					return {
						pages: { start: 1, last, next, previous, current: page },
						docs: { limit: pLimit, total, count: results.length },
						results,
					}
				},
			}
			return use
		}
		async session(callback: () => Promise<any>) {
			if (sessionStore.getStore()) return callback()
			const client = await this.#pool.connect()
			try {
				await client.query('BEGIN')
				const result = await sessionStore.run(client, callback)
				await client.query('COMMIT')
				return result
			} catch (error) {
				await client.query('ROLLBACK')
				throw error
			} finally {
				client.release()
			}
		}
	},
) {}
