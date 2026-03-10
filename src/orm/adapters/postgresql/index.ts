import { AsyncLocalStorage } from 'node:async_hooks'

import { Pool, type PoolClient } from 'pg'
import { v } from 'valleyed'

import { configurable } from '../../../utilities'
import type { Orm } from '../base'
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

export const PostgresqlOrm = configurable(postgresqlConfigPipe, (config): Orm<PostgresqlRepoConfig> => {
	const pool = new Pool({
		host: config.host,
		port: config.port,
		user: config.username,
		password: config.password,
		database: config.database,
		ssl: config.ssl ? { rejectUnauthorized: false } : false,
	})

	const getClient = () => sessionStore.getStore() ?? pool

	const getTableName = (table: PostgresqlRepoConfig) => {
		if (table.schema && table.schema !== 'public') return `${table.schema}.${table.table}`
		return table.table
	}

	return {
		async connect() {},
		async disconnect() {
			await pool.end()
		},
		async findMany(schema, table, queryAst) {
			const tableName = getTableName(table)
			const { sql, params } = buildSelectQuery(queryAst, tableName, schema.primaryKey)
			const result = await getClient().query(sql, params)
			return result.rows
		},
		async findOne(schema, table, queryAst) {
			const limitedAst = { ...queryAst, limit: 1 }
			const results = await this.findMany(schema, table, limitedAst)
			return results[0] ?? null
		},
		async insertOne(schema, table, data, options) {
			const results = await this.insertMany(schema, table, [data], options)
			return results[0]
		},
		async insertMany(schema, table, data, options) {
			const tableName = getTableName(table)
			const now = options?.getTime?.() ?? new Date()
			const client = getClient()
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
		async updateMany(schema, table, queryAst, data, options) {
			const tableName = getTableName(table)
			const now = options?.getTime?.() ?? new Date()
			const fullData = { ...data, updatedAt: now.getTime() }
			const { sql, params } = buildUpdateQuery(queryAst, tableName, schema.primaryKey, fullData)
			const result = await getClient().query(sql, params)
			return result.rows
		},
		async updateOne(schema, table, queryAst, data, options) {
			const limitedAst = { ...queryAst, limit: 1 }
			const results = await this.updateMany(schema, table, limitedAst, data, options)
			return results[0] ?? null
		},
		async upsertOne(schema, table, _queryAst, data, options) {
			const tableName = getTableName(table)
			const now = options?.getTime?.() ?? new Date()
			const id = schema.generateId(0)
			const client = getClient()
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
		async deleteOne(schema, table, queryAst) {
			const limitedAst = { ...queryAst, limit: 1 }
			const results = await this.deleteMany(schema, table, limitedAst)
			return results[0] ?? null
		},
		async deleteMany(schema, table, queryAst) {
			const tableName = getTableName(table)
			const { sql, params } = buildDeleteQuery(queryAst, tableName, schema.primaryKey)
			const result = await getClient().query(sql, params)
			return result.rows
		},
		async session(callback) {
			if (sessionStore.getStore()) return callback()
			const client = await pool.connect()
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
		},
		async query(schema, table, queryAst, pagination) {
			const tableName = getTableName(table)
			const { whereClause, params: countParams } = (() => {
				const { sql, params } = buildCountQuery(queryAst, tableName, schema.primaryKey)
				return { whereClause: sql, params }
			})()
			const countResult = await getClient().query(whereClause, countParams)
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
		},
	} satisfies Orm<PostgresqlRepoConfig>
})
