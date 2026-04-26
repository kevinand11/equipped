import { AsyncLocalStorage } from 'node:async_hooks'

import { Pool, type PoolClient } from 'pg'
import { v, type PipeOutput } from 'valleyed'

import { buildDeleteQuery, buildInsertQuery, buildSelectQuery, buildUpdateQuery } from './query'
import { EquippedError } from '../../../errors'
import { configurable } from '../../../utilities'
import type { AnySchema } from '../../schema'
import { OrmAdapter, type OrmUse } from '../base'

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
		_pool: Pool
		constructor(config: PipeOutput<ReturnType<typeof postgresqlConfigPipe>>) {
			super()
			this._pool = new Pool({
				host: config.host,
				port: config.port,
				user: config.username,
				password: config.password,
				database: config.database,
				ssl: config.ssl ? { rejectUnauthorized: false } : false,
			})
		}

		_getClient() {
			return sessionStore.getStore() ?? this._pool
		}

		async connect() {}
		async disconnect() {
			try {
				await this._pool.end()
			} catch (error) {
				throw new EquippedError('Failed to disconnect PostgreSQL pool', { adapter: 'postgresql' }, error)
			}
		}

		use(schema: AnySchema, config: PostgresqlRepoConfig): OrmUse {
			const tableName = config.schema && config.schema !== 'public' ? `${config.schema}.${config.table}` : config.table
			const use: OrmUse = {
				findMany: async (filter, options) => {
					try {
						const { sql, params } = buildSelectQuery(filter, options, tableName, schema.pkField.name)
						const result = await this._getClient().query(sql, params)
						return result.rows
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL findMany failed',
							{ adapter: 'postgresql', operation: 'findMany', table: tableName },
							error,
						)
					}
				},
				findOne: async (filter) => {
					try {
						const results = await use.findMany(filter, { limit: 1 })
						return results[0] ?? null
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL findOne failed',
							{ adapter: 'postgresql', operation: 'findOne', table: tableName },
							error,
						)
					}
				},
				insertMany: async (data) => {
					try {
						const client = this._getClient()
						const results: any[] = []
						for (const doc of data) {
							const { sql, params } = buildInsertQuery(tableName, doc)
							const result = await client.query(sql, params)
							results.push(result.rows[0])
						}
						return results
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL insertMany failed',
							{ adapter: 'postgresql', operation: 'insertMany', table: tableName },
							error,
						)
					}
				},
				insertOne: async (data) => {
					try {
						const results = await use.insertMany([data])
						return results[0]
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL insertOne failed',
							{ adapter: 'postgresql', operation: 'insertOne', table: tableName },
							error,
						)
					}
				},
				updateMany: async (filter, data) => {
					try {
						const { sql, params } = buildUpdateQuery(filter, tableName, schema.pkField.name, data)
						const result = await this._getClient().query(sql, params)
						return result.rows
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL updateMany failed',
							{ adapter: 'postgresql', operation: 'updateMany', table: tableName },
							error,
						)
					}
				},
				updateOne: async (filter, data) => {
					try {
						const results = await use.updateMany(filter, data)
						return results[0] ?? null
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL updateOne failed',
							{ adapter: 'postgresql', operation: 'updateOne', table: tableName },
							error,
						)
					}
				},
				upsertOne: async (_filter, data) => {
					try {
						const client = this._getClient()
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
							`INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT ("${schema.pkField.name}") DO UPDATE SET ${updateParts.join(', ')} RETURNING *`.replace(
								/\s+/g,
								' ',
							)
						const result = await client.query(sql, values)
						return result.rows[0]
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL upsertOne failed',
							{ adapter: 'postgresql', operation: 'upsertOne', table: tableName },
							error,
						)
					}
				},
				deleteMany: async (filter) => {
					try {
						const { sql, params } = buildDeleteQuery(filter, tableName, schema.pkField.name)
						const result = await this._getClient().query(sql, params)
						return result.rows
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL deleteMany failed',
							{ adapter: 'postgresql', operation: 'deleteMany', table: tableName },
							error,
						)
					}
				},
				deleteOne: async (filter) => {
					try {
						const results = await use.deleteMany(filter)
						return results[0] ?? null
					} catch (error) {
						throw new EquippedError(
							'PostgreSQL deleteOne failed',
							{ adapter: 'postgresql', operation: 'deleteOne', table: tableName },
							error,
						)
					}
				},
				raw: async <T = unknown>(command, params: unknown[] = []) => {
					try {
						if (typeof command !== 'string') {
							throw new EquippedError('PostgreSQL raw requires a SQL string command', {
								adapter: 'postgresql',
								operation: 'raw',
								table: tableName,
							})
						}
						const result = await this._getClient().query(command, params as any[])
						return result as T
					} catch (error) {
						if (error instanceof EquippedError) throw error
						throw new EquippedError(
							'PostgreSQL raw failed',
							{ adapter: 'postgresql', operation: 'raw', table: tableName },
							error,
						)
					}
				},
			}
			return use
		}

		async session<T>(callback: () => Promise<T>) {
			if (sessionStore.getStore()) return callback()
			let client: PoolClient | undefined
			try {
				client = await this._pool.connect()
				await client.query('BEGIN')
				const result = await sessionStore.run(client, callback)
				await client.query('COMMIT')
				return result
			} catch (error) {
				if (client) {
					try {
						await client.query('ROLLBACK')
					} catch {
						// ignore rollback errors and report original failure
					}
				}
				throw new EquippedError('PostgreSQL session failed', { adapter: 'postgresql', operation: 'session' }, error)
			} finally {
				client?.release()
			}
		}
	},
) {}
