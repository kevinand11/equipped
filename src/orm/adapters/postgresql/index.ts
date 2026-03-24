import { AsyncLocalStorage } from 'node:async_hooks'

import { Pool, type PoolClient } from 'pg'
import { v, type PipeOutput } from 'valleyed'

import { configurable } from '../../../utilities'
import type { AnySchema } from '../../schema'
import { OrmAdapter, type OrmUse } from '../base'
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
	class extends OrmAdapter<PostgresqlRepoConfig> {
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

		use(schema: AnySchema, config: PostgresqlRepoConfig): OrmUse {
			const tableName = config.schema && config.schema !== 'public' ? `${config.schema}.${config.table}` : config.table
			const use: OrmUse = {
				findMany: async (filter, options) => {
					const { sql, params } = buildSelectQuery(filter, options, tableName, schema.pkName)
					const result = await this.#getClient().query(sql, params)
					return result.rows
				},
				findOne: async (filter) => {
					const results = await use.findMany(filter, { limit: 1 })
					return results[0] ?? null
				},
				insertMany: async (data) => {
					const client = this.#getClient()
					const results: any[] = []
					for (const doc of data) {
						const { sql, params } = buildInsertQuery(tableName, doc)
						const result = await client.query(sql, params)
						results.push(result.rows[0])
					}
					return results
				},
				insertOne: async (data) => {
					const results = await use.insertMany([data])
					return results[0]
				},
				updateMany: async (filter, data) => {
					const { sql, params } = buildUpdateQuery(filter, tableName, schema.pkName, data)
					const result = await this.#getClient().query(sql, params)
					return result.rows
				},
				updateOne: async (filter, data) => {
					const results = await use.updateMany(filter, data)
					return results[0] ?? null
				},
				upsertOne: async (_filter, data) => {
					const client = this.#getClient()
					const insertData = data.insert
					const updateData = 'update' in data ? data.update : data.insert
					const columns = Object.keys(insertData)
					const values = Object.values(insertData)
					const placeholders = columns.map((_, i) => `$${i + 1}`)
					const updateParts = Object.keys(updateData).map((key) => {
						values.push(updateData[key])
						return `"${key}" = $${values.length}`
					})
					const sql =
						`INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT ("${schema.pkName}") DO UPDATE SET ${updateParts.join(', ')} RETURNING *`.replace(
							/\s+/g,
							' ',
						)
					const result = await client.query(sql, values)
					return result.rows[0]
				},
				deleteMany: async (filter) => {
					const { sql, params } = buildDeleteQuery(filter, tableName, schema.pkName)
					const result = await this.#getClient().query(sql, params)
					return result.rows
				},
				deleteOne: async (filter) => {
					const results = await use.deleteMany(filter)
					return results[0] ?? null
				},
				paginatedQuery: async (filter, pagination) => {
					const { sql: countSql, params: countParams } = buildCountQuery(filter, tableName, schema.pkName)
					const countResult = await this.#getClient().query(countSql, countParams)
					const total = Number(countResult.rows[0]?.count ?? 0)
					const options = pagination.all
						? undefined
						: { limit: pagination.limit, offset: (pagination.page - 1) * pagination.limit }
					const results = await use.findMany(filter, options)
					const { page, limit: pLimit } = pagination
					const last = Math.ceil(total / pLimit) || 1
					return {
						pages: { start: 1, last, next: page >= last ? null : page + 1, previous: page <= 1 ? null : page - 1, current: page },
						docs: { limit: pLimit, total, count: results.length },
						results,
					}
				},
			}
			return use
		}

		async session<T>(callback: () => Promise<T>) {
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
