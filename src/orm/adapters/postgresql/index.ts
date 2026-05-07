import { AsyncLocalStorage } from 'node:async_hooks'

import { Pool, type PoolClient } from 'pg'
import { v } from 'valleyed'

import {
	buildCreateQuery,
	buildDeleteQuery,
	buildPkUpdateQuery,
	buildSelectQuery,
	buildUpdateQuery,
	buildUpsertQuery,
	extractUpsertConflictColumn,
} from './query'
import { EquippedError } from '../../../errors'
import { configurable } from '../../../utilities'
import type { FilterGroup } from '../../filter'
import { OrmAdapter } from '../../orm-adapter'
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

const postgresqlConnectionPipe = () =>
	v.object({
		host: v.string(),
		port: v.number(),
		username: v.string(),
		password: v.string(),
		database: v.string(),
		ssl: v.defaults(v.boolean(), false),
	})

export class PostgresAdapter extends configurable(postgresqlConnectionPipe, OrmAdapter) {
	readonly schemaConfigPipe = v.object({
		schema: v.optional(v.string()),
		table: v.string(),
	})

	readonly supportedFieldTypes = ['string', 'number', 'boolean', 'null', 'object', 'array', 'date'] as const
	readonly queryableOps = [
		'eq',
		'ne',
		'gt',
		'gte',
		'lt',
		'lte',
		'in',
		'notIn',
		'like',
		'exists',
		'notExists',
		'contains',
		'notContains',
	] as const
	readonly updateOps = ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch'] as const

	readonly pool: Pool
	#sessionStore = new AsyncLocalStorage<PoolClient | undefined>()

	protected constructor(config: typeof PostgresAdapter.Config) {
		super(config)
		this.pool = new Pool({
			host: config.host,
			port: config.port,
			user: config.username,
			password: config.password,
			database: config.database,
			ssl: config.ssl ? { rejectUnauthorized: false } : false,
		})
	}

	#getClient() {
		return this.#sessionStore.getStore() ?? this.pool
	}

	#resolveTableName(config: PostgresqlRepoConfig) {
		return config.schema && config.schema !== 'public' ? `${config.schema}.${config.table}` : config.table
	}

	async connect() {}

	async disconnect() {
		try {
			await this.pool.end()
		} catch (error) {
			throw new EquippedError('Failed to disconnect PostgreSQL pool', { adapter: 'postgresql' }, error)
		}
	}

	async findByPk(schema: AnySchema, config: unknown, pk: unknown) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const pkName = schema.pkField.name
			const result = await this.#getClient().query(`SELECT * FROM "${tableName}" WHERE "${pkName}" = $1`, [pk])
			return result.rows[0] ?? null
		} catch (error) {
			throw new EquippedError('PostgreSQL findByPk failed', { adapter: 'postgresql', operation: 'findByPk', table: c.table }, error)
		}
	}

	async createMany(_schema: AnySchema, config: unknown, data: Record<string, unknown>[]) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const client = this.#getClient()
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
				{ adapter: 'postgresql', operation: 'createMany', table: c.table },
				error,
			)
		}
	}

	async updateByPk(schema: AnySchema, config: unknown, pk: unknown, ops: AnyUpdateOp[]) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const pkName = schema.pkField.name
			const data = flattenOps(ops)
			if (Object.keys(data).length === 0) {
				const result = await this.#getClient().query(`SELECT * FROM "${tableName}" WHERE "${pkName}" = $1`, [pk])
				return result.rows[0] ?? null
			}
			const { sql, params } = buildPkUpdateQuery(tableName, pkName, pk, data)
			const result = await this.#getClient().query(sql, params)
			return result.rows[0] ?? null
		} catch (error) {
			throw new EquippedError(
				'PostgreSQL updateByPk failed',
				{ adapter: 'postgresql', operation: 'updateByPk', table: c.table },
				error,
			)
		}
	}

	async deleteByPk(schema: AnySchema, config: unknown, pk: unknown) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const pkName = schema.pkField.name
			const result = await this.#getClient().query(`DELETE FROM "${tableName}" WHERE "${pkName}" = $1 RETURNING *`, [pk])
			return result.rows[0] ?? null
		} catch (error) {
			throw new EquippedError(
				'PostgreSQL deleteByPk failed',
				{ adapter: 'postgresql', operation: 'deleteByPk', table: c.table },
				error,
			)
		}
	}

	async raw(_schema: AnySchema, config: unknown, command: string, params: unknown[] = []) {
		const c = config as PostgresqlRepoConfig
		try {
			const result = await this.#getClient().query(command, params)
			return result
		} catch (error) {
			if (error instanceof EquippedError) throw error
			throw new EquippedError('PostgreSQL raw failed', { adapter: 'postgresql', operation: 'raw', table: c.table }, error)
		}
	}

	async findMany(schema: AnySchema, config: unknown, filter: FilterGroup, options?: QueryOptions) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const { sql, params } = buildSelectQuery(filter, options, tableName, schema.pkField.name)
			const result = await this.#getClient().query(sql, params)
			return result.rows
		} catch (error) {
			throw new EquippedError('PostgreSQL findMany failed', { adapter: 'postgresql', operation: 'findMany', table: c.table }, error)
		}
	}

	async updateMany(schema: AnySchema, config: unknown, filter: FilterGroup, data: Record<string, unknown>) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const { sql, params } = buildUpdateQuery(filter, tableName, schema.pkField.name, data)
			const result = await this.#getClient().query(sql, params)
			return result.rows
		} catch (error) {
			throw new EquippedError(
				'PostgreSQL updateMany failed',
				{ adapter: 'postgresql', operation: 'updateMany', table: c.table },
				error,
			)
		}
	}

	async deleteMany(schema: AnySchema, config: unknown, filter: FilterGroup) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const { sql, params } = buildDeleteQuery(filter, tableName, schema.pkField.name)
			const result = await this.#getClient().query(sql, params)
			return result.rows
		} catch (error) {
			throw new EquippedError(
				'PostgreSQL deleteMany failed',
				{ adapter: 'postgresql', operation: 'deleteMany', table: c.table },
				error,
			)
		}
	}

	async upsertOne(schema: AnySchema, config: unknown, filter: FilterGroup, create: Record<string, unknown>, ops: AnyUpdateOp[]) {
		const c = config as PostgresqlRepoConfig
		try {
			const tableName = this.#resolveTableName(c)
			const conflictColumn = extractUpsertConflictColumn(filter, schema.name)
			const data = ops.length > 0 ? flattenOps(ops) : {}
			const { sql, params } = buildUpsertQuery(tableName, conflictColumn, schema.pkField.name, create, data)
			const result = await this.#getClient().query(sql, params)
			return result.rows[0]
		} catch (error) {
			if (error instanceof EquippedError) throw error
			throw new EquippedError('PostgreSQL upsertOne failed', { adapter: 'postgresql', operation: 'upsertOne', table: c.table }, error)
		}
	}

	async session<T>(fn: () => Promise<T>): Promise<T> {
		if (this.#sessionStore.getStore()) return fn()
		let client: PoolClient | undefined
		try {
			client = await this.pool.connect()
			await client.query('BEGIN')
			const result = await this.#sessionStore.run(client, fn)
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
	}
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf, vi, beforeEach, afterEach } = import.meta.vitest

	const testConnectionConfig = {
		host: 'localhost',
		port: 5432,
		username: 'test',
		password: 'test',
		database: 'testdb',
		ssl: false,
	} as const

	describe('PostgresAdapter: class-via-configurable shape', () => {
		let onSpy: ReturnType<typeof vi.spyOn>

		beforeEach(async () => {
			const { Instance } = await import('../../../instance')
			onSpy = vi.spyOn(Instance, 'on').mockImplementation(() => {})
		})

		afterEach(() => {
			onSpy.mockRestore()
		})

		test('PostgresAdapter.create returns instance with correct capability declarations', () => {
			const adapter = PostgresAdapter.create(testConnectionConfig)

			expect(adapter.supportedFieldTypes).toEqual(['string', 'number', 'boolean', 'null', 'object', 'array', 'date'])
			expect(adapter.queryableOps).toEqual([
				'eq',
				'ne',
				'gt',
				'gte',
				'lt',
				'lte',
				'in',
				'notIn',
				'like',
				'exists',
				'notExists',
				'contains',
				'notContains',
			])
			expect(adapter.updateOps).toEqual(['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch'])
		})

		test('PostgresAdapter.create validates connection config', () => {
			expect(() => PostgresAdapter.create({ host: 123, port: 'bad' } as any)).toThrow()
		})

		test('pool is exposed as a readonly instance field', () => {
			const adapter = PostgresAdapter.create(testConnectionConfig)

			expect(adapter.pool).toBeInstanceOf(Pool)
		})

		test('schemaConfigPipe is declared as readonly with table-name shape', () => {
			const adapter = PostgresAdapter.create(testConnectionConfig)

			expect(adapter.schemaConfigPipe).toBeDefined()
		})

		test('auto-wires Instance hooks for connect and disconnect', () => {
			PostgresAdapter.create(testConnectionConfig)

			expect(onSpy).toHaveBeenCalledWith('start', expect.any(Function), expect.objectContaining({ class: PostgresAdapter }))
			expect(onSpy).toHaveBeenCalledWith('close', expect.any(Function), expect.objectContaining({ class: PostgresAdapter }))
		})

		test('adapter.use returns OrmUse-shaped object', async () => {
			const { Schema } = await import('../../schema')

			const schema = Schema.from('test')
				.pk('id', v.string(), () => 'x')
				.build()
			const adapter = PostgresAdapter.create(testConnectionConfig)
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

		test('type-level: capability declarations use as const', () => {
			const _adapter = PostgresAdapter.create(testConnectionConfig)

			type Ops = typeof _adapter.updateOps
			expectTypeOf<Ops>().toEqualTypeOf<readonly ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch']>()

			type Types = typeof _adapter.supportedFieldTypes
			expectTypeOf<Types>().toEqualTypeOf<readonly ['string', 'number', 'boolean', 'null', 'object', 'array', 'date']>()

			type QOps = typeof _adapter.queryableOps
			expectTypeOf<QOps>().toEqualTypeOf<
				readonly ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains']
			>()
		})

		test('type-level: Repo.from with PostgresAdapter enables all builder methods', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')

			const adapter = PostgresAdapter.create(testConnectionConfig)
			const repo = Repo.from(adapter)
				.resolve(() => ({ table: 'test' }))
				.build()
			const _TestSchema = Schema.from('test')
				.pk('id', v.string(), () => 'x')
				.build()

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

		test('type-level: raw arg-tuple infers (command: string, params?: unknown[]) from PostgresAdapter', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')

			const adapter = PostgresAdapter.create(testConnectionConfig)
			const repo = Repo.from(adapter)
				.resolve(() => ({ table: 'test' }))
				.build()
			const _TestSchema = Schema.from('test')
				.pk('id', v.string(), () => 'x')
				.build()
			const _ref = repo.on(_TestSchema)

			expectTypeOf(_ref.raw).parameters.toEqualTypeOf<[command: string, params?: unknown[]]>()
		})

		test('type-level: per-call <T> override narrows PostgresAdapter raw return type', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')

			const adapter = PostgresAdapter.create(testConnectionConfig)
			const repo = Repo.from(adapter)
				.resolve(() => ({ table: 'test' }))
				.build()
			const _TestSchema = Schema.from('test')
				.pk('id', v.string(), () => 'x')
				.build()
			const _ref = repo.on(_TestSchema)

			expectTypeOf(_ref.raw<{ id: string }[]>).returns.toEqualTypeOf<Promise<{ id: string }[]>>()
		})

		test('raw forwards (command, params) to pool.query at runtime', async () => {
			const { Schema } = await import('../../schema')

			const schema = Schema.from('pg_raw')
				.pk('id', v.string(), () => 'x')
				.build()
			const adapter = PostgresAdapter.create(testConnectionConfig)
			let capturedCommand: unknown
			let capturedParams: unknown
			const mockResult = { rows: [{ id: '1' }], rowCount: 1 }
			;(adapter.pool as any).query = async (cmd: unknown, params: unknown) => {
				capturedCommand = cmd
				capturedParams = params
				return mockResult
			}
			const result = await adapter.use(schema, { table: 'users' }).raw('SELECT * FROM users WHERE id = $1', ['abc'])
			expect(capturedCommand).toBe('SELECT * FROM users WHERE id = $1')
			expect(capturedParams).toEqual(['abc'])
			expect(result).toBe(mockResult)
		})

		test('raw defaults params to [] when omitted', async () => {
			const { Schema } = await import('../../schema')

			const schema = Schema.from('pg_raw2')
				.pk('id', v.string(), () => 'x')
				.build()
			const adapter = PostgresAdapter.create(testConnectionConfig)
			let capturedParams: unknown
			;(adapter.pool as any).query = async (_cmd: unknown, params: unknown) => {
				capturedParams = params
				return { rows: [] }
			}
			await adapter.use(schema, { table: 'users' }).raw('SELECT 1')
			expect(capturedParams).toEqual([])
		})

		test('session method is exposed on the adapter', () => {
			const adapter = PostgresAdapter.create(testConnectionConfig)
			expect(adapter.session).toBeDefined()
			expect(adapter.session).toBeTypeOf('function')
		})
	})
}
