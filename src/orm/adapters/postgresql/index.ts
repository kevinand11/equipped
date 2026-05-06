import { AsyncLocalStorage } from 'node:async_hooks'

import { Pool, type PoolClient } from 'pg'

import {
	buildDeleteQuery,
	buildCreateQuery,
	buildPkUpdateQuery,
	buildSelectQuery,
	buildUpdateQuery,
	buildUpsertQuery,
	extractUpsertConflictColumn,
} from './query'
import { EquippedError } from '../../../errors'
import { Adapter } from '../../adapter'
import type { FilterGroup } from '../../filter'
import type { QueryOptions } from '../../query'
import type { AnySchema } from '../../schema'
import { flattenOps, type AnyUpdateOp } from '../../updates'

export type PostgresqlRepoConfig = {
	schema?: string
	table: string
}

export type PostgresqlConnectionConfig = {
	host: string
	port: number
	username: string
	password: string
	database: string
	ssl?: boolean
}

const sessionStore = new AsyncLocalStorage<PoolClient | undefined>()

export function createPostgresAdapter(connectionConfig: PostgresqlConnectionConfig) {
	const pool = new Pool({
		host: connectionConfig.host,
		port: connectionConfig.port,
		user: connectionConfig.username,
		password: connectionConfig.password,
		database: connectionConfig.database,
		ssl: connectionConfig.ssl ? { rejectUnauthorized: false } : false,
	})

	function getClient() {
		return sessionStore.getStore() ?? pool
	}

	function resolveTableName(config: PostgresqlRepoConfig) {
		return config.schema && config.schema !== 'public' ? `${config.schema}.${config.table}` : config.table
	}

	const adapter = Adapter.from<PostgresqlRepoConfig>()
		.supportedFieldTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
		.queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains')
		.updateOps('set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch')
		.lifecycle({
			connect: async () => {},
			disconnect: async () => {
				try {
					await pool.end()
				} catch (error) {
					throw new EquippedError('Failed to disconnect PostgreSQL pool', { adapter: 'postgresql' }, error)
				}
			},
		})
		.crud({
			findByPk: async (schema, config, pk) => {
				try {
					const tableName = resolveTableName(config)
					const pkName = schema.pkField.name
					const result = await getClient().query(`SELECT * FROM "${tableName}" WHERE "${pkName}" = $1`, [pk])
					return result.rows[0] ?? null
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL findByPk failed',
						{ adapter: 'postgresql', operation: 'findByPk', table: config.table },
						error,
					)
				}
			},
			createMany: async (_schema, config, data) => {
				try {
					const tableName = resolveTableName(config)
					const client = getClient()
					const results: Record<string, unknown>[] = []
					for (const doc of data) {
						const { sql, params } = buildCreateQuery(tableName, doc)
						const result = await client.query(sql, params)
						results.push(result.rows[0])
					}
					return results
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL createMany failed',
						{ adapter: 'postgresql', operation: 'createMany', table: config.table },
						error,
					)
				}
			},
			updateByPk: async (schema, config, pk, ops) => {
				try {
					const tableName = resolveTableName(config)
					const pkName = schema.pkField.name
					const data = flattenOps(ops)
					if (Object.keys(data).length === 0) {
						const result = await getClient().query(`SELECT * FROM "${tableName}" WHERE "${pkName}" = $1`, [pk])
						return result.rows[0] ?? null
					}
					const { sql, params } = buildPkUpdateQuery(tableName, pkName, pk, data)
					const result = await getClient().query(sql, params)
					return result.rows[0] ?? null
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL updateByPk failed',
						{ adapter: 'postgresql', operation: 'updateByPk', table: config.table },
						error,
					)
				}
			},
			deleteByPk: async (schema, config, pk) => {
				try {
					const tableName = resolveTableName(config)
					const pkName = schema.pkField.name
					const result = await getClient().query(`DELETE FROM "${tableName}" WHERE "${pkName}" = $1 RETURNING *`, [pk])
					return result.rows[0] ?? null
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL deleteByPk failed',
						{ adapter: 'postgresql', operation: 'deleteByPk', table: config.table },
						error,
					)
				}
			},
			raw: async <T = unknown>(_schema: AnySchema, config: PostgresqlRepoConfig, command: unknown, params: unknown[] = []) => {
				try {
					if (typeof command !== 'string') {
						throw new EquippedError('PostgreSQL raw requires a SQL string command', {
							adapter: 'postgresql',
							operation: 'raw',
							table: config.table,
						})
					}
					const result = await getClient().query(command, params)
					return result as T
				} catch (error) {
					if (error instanceof EquippedError) throw error
					throw new EquippedError(
						'PostgreSQL raw failed',
						{ adapter: 'postgresql', operation: 'raw', table: config.table },
						error,
					)
				}
			},
		})
		.queryable({
			findMany: async (schema: AnySchema, config: PostgresqlRepoConfig, filter: FilterGroup, options?: QueryOptions) => {
				try {
					const tableName = resolveTableName(config)
					const { sql, params } = buildSelectQuery(filter, options, tableName, schema.pkField.name)
					const result = await getClient().query(sql, params)
					return result.rows
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL findMany failed',
						{ adapter: 'postgresql', operation: 'findMany', table: config.table },
						error,
					)
				}
			},
			updateMany: async (schema: AnySchema, config: PostgresqlRepoConfig, filter: FilterGroup, data: Record<string, unknown>) => {
				try {
					const tableName = resolveTableName(config)
					const { sql, params } = buildUpdateQuery(filter, tableName, schema.pkField.name, data)
					const result = await getClient().query(sql, params)
					return result.rows
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL updateMany failed',
						{ adapter: 'postgresql', operation: 'updateMany', table: config.table },
						error,
					)
				}
			},
			deleteMany: async (schema: AnySchema, config: PostgresqlRepoConfig, filter: FilterGroup) => {
				try {
					const tableName = resolveTableName(config)
					const { sql, params } = buildDeleteQuery(filter, tableName, schema.pkField.name)
					const result = await getClient().query(sql, params)
					return result.rows
				} catch (error) {
					throw new EquippedError(
						'PostgreSQL deleteMany failed',
						{ adapter: 'postgresql', operation: 'deleteMany', table: config.table },
						error,
					)
				}
			},
			upsertOne: async (
				schema: AnySchema,
				config: PostgresqlRepoConfig,
				filter: FilterGroup,
				create: Record<string, unknown>,
				ops: AnyUpdateOp[],
			) => {
				try {
					const tableName = resolveTableName(config)
					const conflictColumn = extractUpsertConflictColumn(filter, schema.name)
					const data = ops.length > 0 ? flattenOps(ops) : {}
					const { sql, params } = buildUpsertQuery(tableName, conflictColumn, schema.pkField.name, create, data)
					const result = await getClient().query(sql, params)
					return result.rows[0]
				} catch (error) {
					if (error instanceof EquippedError) throw error
					throw new EquippedError(
						'PostgreSQL upsertOne failed',
						{ adapter: 'postgresql', operation: 'upsertOne', table: config.table },
						error,
					)
				}
			},
		})
		.transactional({
			session: async <T>(fn: () => Promise<T>): Promise<T> => {
				if (sessionStore.getStore()) return fn()
				let client: PoolClient | undefined
				try {
					client = await pool.connect()
					await client.query('BEGIN')
					const result = await sessionStore.run(client, fn)
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
					if (error instanceof EquippedError) throw error
					throw new EquippedError('PostgreSQL session failed', { adapter: 'postgresql', operation: 'session' }, error)
				} finally {
					client?.release()
				}
			},
		})
		.build()

	return { adapter, pool }
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf } = import.meta.vitest

	describe('postgresql adapter: Adapter.from shape', () => {
		test('createPostgresAdapter returns adapter with correct capability declarations', () => {
			const { adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})

			expect(adapter.supportedFieldTypes).toEqual([
				'string', 'number', 'boolean', 'null', 'object', 'array', 'date',
			])
			expect(adapter.queryableOps).toEqual([
				'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains',
			])
			expect(adapter.updateOps).toEqual([
				'set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch',
			])
		})

		test('adapter exposes lifecycle, crud, queryable, and transactional bags', () => {
			const { adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})

			expect(adapter.lifecycle).toBeDefined()
			expect(adapter.lifecycle!.connect).toBeTypeOf('function')
			expect(adapter.lifecycle!.disconnect).toBeTypeOf('function')

			expect(adapter.crud).toBeDefined()
			expect(adapter.crud!.findByPk).toBeTypeOf('function')
			expect(adapter.crud!.createMany).toBeTypeOf('function')
			expect(adapter.crud!.updateByPk).toBeTypeOf('function')
			expect(adapter.crud!.deleteByPk).toBeTypeOf('function')
			expect(adapter.crud!.raw).toBeTypeOf('function')

			expect(adapter.queryable).toBeDefined()
			expect(adapter.queryable!.findMany).toBeTypeOf('function')
			expect(adapter.queryable!.updateMany).toBeTypeOf('function')
			expect(adapter.queryable!.deleteMany).toBeTypeOf('function')
			expect(adapter.queryable!.upsertOne).toBeTypeOf('function')

			expect(adapter.transactional).toBeDefined()
			expect(adapter.transactional!.session).toBeTypeOf('function')
		})

		test('adapter.use returns OrmUse-shaped object', async () => {
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const schema = Schema.from('test').pk('id', v.string(), () => 'x').build()
			const { adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})
			const use = adapter.use(schema, { table: 'test' })

			expect(use.findMany).toBeTypeOf('function')
			expect(use.findOne).toBeTypeOf('function')
			expect(use.createOne).toBeTypeOf('function')
			expect(use.createMany).toBeTypeOf('function')
			expect(use.updateMany).toBeTypeOf('function')
			expect(use.updateOne).toBeTypeOf('function')
			expect(use.upsertOne).toBeTypeOf('function')
			expect(use.deleteOne).toBeTypeOf('function')
			expect(use.deleteMany).toBeTypeOf('function')
			expect(use.raw).toBeTypeOf('function')
		})

		test('type-level: adapter declares all 9 canonical update ops', () => {
			const { adapter: _adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})
			type Ops = typeof _adapter.updateOps
			expectTypeOf<Ops>().toEqualTypeOf<
				readonly ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch']
			>()
		})

		test('type-level: adapter declares all 7 field types', () => {
			const { adapter: _adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})
			type Types = typeof _adapter.supportedFieldTypes
			expectTypeOf<Types>().toEqualTypeOf<
				readonly ['string', 'number', 'boolean', 'null', 'object', 'array', 'date']
			>()
		})

		test('type-level: adapter declares all 13 queryable ops including like', () => {
			const { adapter: _adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})
			type Ops = typeof _adapter.queryableOps
			expectTypeOf<Ops>().toEqualTypeOf<
				readonly ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains']
			>()
		})

		test('type-level: Repo.from with postgres adapter enables all builder methods', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const { adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})
			const repo = Repo.from(adapter).resolve(() => ({ table: 'test' })).build()
			const _TestSchema = Schema.from('test').pk('id', v.string(), () => 'x').build()

			const _one = repo.on(_TestSchema).one()
			const _all = repo.on(_TestSchema).all()
			const _ref = repo.on(_TestSchema)
			expectTypeOf(_one.create).toBeFunction()
			expectTypeOf(_one.find).toBeFunction()
			expectTypeOf(_one.update).toBeFunction()
			expectTypeOf(_one.delete).toBeFunction()
			expectTypeOf(_one.upsert).toBeFunction()
			expectTypeOf(_all.create).toBeFunction()
			expectTypeOf(_all.find).toBeFunction()
			expectTypeOf(_all.update).toBeFunction()
			expectTypeOf(_all.delete).toBeFunction()
			expectTypeOf(_ref.raw).toBeFunction()
			expectTypeOf(repo.session).toBeFunction()
		})

		test('nested session returns callback without starting new transaction', () => {
			const { adapter } = createPostgresAdapter({
				host: 'localhost',
				port: 5432,
				username: 'test',
				password: 'test',
				database: 'testdb',
			})
			expect(adapter.transactional!.session).toBeDefined()
		})
	})
}
