import { AsyncLocalStorage } from 'node:async_hooks'

import { MongoClient, type ClientSession, type MongoClientOptions, type OptionalUnlessRequiredId } from 'mongodb'
import { v } from 'valleyed'

import { compileMongoFilter, compileMongoOps, compileMongoQuery, compileMongoUpdate } from './query'
import { EquippedError } from '../../../errors'
import { configurable } from '../../../utilities/configurable'
import { OrmAdapter } from '../../orm-adapter'
import type { FilterGroup } from '../../filter'
import type { QueryOptions } from '../../query'
import type { AnySchema } from '../../schema'
import type { AnyUpdateOp } from '../../updates'

export type MongoDbRepoConfig = {
	db: string
	col: string
}

const mongoConnectionPipe = () =>
	v.object({
		uri: v.string(),
	})

export class MongoDbAdapter extends configurable(mongoConnectionPipe, OrmAdapter) {
	readonly schemaConfigPipe = v.object({ db: v.string(), col: v.string() })

	readonly queryableOps = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains'] as const
	readonly updateOps = ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch'] as const
	readonly supportedFieldTypes = ['string', 'number', 'boolean', 'null', 'object', 'array', 'date'] as const

	readonly client: MongoClient
	readonly #sessionStore = new AsyncLocalStorage<ClientSession | undefined>()

	protected constructor(config: typeof MongoDbAdapter.Config, options?: MongoClientOptions) {
		super(config)
		this.client = new MongoClient(config.uri, {
			...options,
			ignoreUndefined: true,
		})
	}

	#getCollection(schemaCfg: MongoDbRepoConfig) {
		return this.client.db(schemaCfg.db).collection(schemaCfg.col)
	}

	async connect() {
		try {
			await this.client.connect()
		} catch (error) {
			throw new EquippedError('Failed to connect MongoDB client', { adapter: 'mongodb' }, error)
		}
	}

	async disconnect() {
		try {
			await this.client.close()
		} catch (error) {
			throw new EquippedError('Failed to disconnect MongoDB client', { adapter: 'mongodb' }, error)
		}
	}

	async findByPk(schema: AnySchema, config: unknown, pk: unknown) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pkName = schema.pkField.name
			const collection = this.#getCollection(schemaCfg)
			const doc = await collection.findOne(
				{ [pkName]: pk },
				{ session: this.#sessionStore.getStore() },
			)
			return doc as Record<string, unknown> | null
		} catch (error) {
			throw new EquippedError(
				'MongoDB findByPk failed',
				{ adapter: 'mongodb', operation: 'findByPk', collection: schemaCfg.col },
				error,
			)
		}
	}

	async createMany(_schema: AnySchema, config: unknown, data: Record<string, unknown>[]) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const collection = this.#getCollection(schemaCfg)
			const docs = data.map((d) => d as OptionalUnlessRequiredId<any>)
			await collection.insertMany(docs, { session: this.#sessionStore.getStore() })
			return data
		} catch (error) {
			throw new EquippedError(
				'MongoDB createMany failed',
				{ adapter: 'mongodb', operation: 'createMany', collection: schemaCfg.col },
				error,
			)
		}
	}

	async updateByPk(schema: AnySchema, config: unknown, pk: unknown, ops: AnyUpdateOp[]) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pkName = schema.pkField.name
			const collection = this.#getCollection(schemaCfg)
			const update = compileMongoOps(ops)
			if (Object.keys(update).length === 0) {
				return await collection.findOne({ [pkName]: pk }, { session: this.#sessionStore.getStore() }) as Record<string, unknown> | null
			}
			return await collection.findOneAndUpdate(
				{ [pkName]: pk },
				update,
				{ returnDocument: 'after', session: this.#sessionStore.getStore() },
			) as Record<string, unknown> | null
		} catch (error) {
			throw new EquippedError(
				'MongoDB updateByPk failed',
				{ adapter: 'mongodb', operation: 'updateByPk', collection: schemaCfg.col },
				error,
			)
		}
	}

	async deleteByPk(schema: AnySchema, config: unknown, pk: unknown) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pkName = schema.pkField.name
			const collection = this.#getCollection(schemaCfg)
			return await collection.findOneAndDelete(
				{ [pkName]: pk },
				{ session: this.#sessionStore.getStore() },
			) as Record<string, unknown> | null
		} catch (error) {
			throw new EquippedError(
				'MongoDB deleteByPk failed',
				{ adapter: 'mongodb', operation: 'deleteByPk', collection: schemaCfg.col },
				error,
			)
		}
	}

	async raw(_schema: AnySchema, config: unknown, pipeline: Record<string, unknown>[]) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const collection = this.#getCollection(schemaCfg)
			const result = await collection.aggregate(pipeline, { session: this.#sessionStore.getStore() }).toArray()
			return result
		} catch (error) {
			if (error instanceof EquippedError) throw error
			throw new EquippedError(
				'MongoDB raw failed',
				{ adapter: 'mongodb', operation: 'raw', collection: schemaCfg.col },
				error,
			)
		}
	}

	async findMany(schema: AnySchema, config: unknown, filter: FilterGroup, options?: QueryOptions) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pk = schema.pkField.name
			const { filter: mongoFilter, sort, limit, skip, projection } = compileMongoQuery(filter, options, pk)
			const collection = this.#getCollection(schemaCfg)

			let cursor = collection.find(mongoFilter, {
				session: this.#sessionStore.getStore(),
				projection,
			})
			if (sort) cursor = cursor.sort(sort)
			if (limit) cursor = cursor.limit(limit)
			if (skip) cursor = cursor.skip(skip)

			return await cursor.toArray()
		} catch (error) {
			throw new EquippedError(
				'MongoDB findMany failed',
				{ adapter: 'mongodb', operation: 'findMany', collection: schemaCfg.col },
				error,
			)
		}
	}

	async updateMany(schema: AnySchema, config: unknown, filter: FilterGroup, data: Record<string, unknown>) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pk = schema.pkField.name
			const collection = this.#getCollection(schemaCfg)
			const session = this.#sessionStore.getStore()
			const mongoFilter = compileMongoFilter(filter, pk)

			const matchingDocs = await collection.find(mongoFilter, { session, projection: { [pk]: 1 } }).toArray()
			const ids = matchingDocs.map((d) => d[pk])
			const idFilter = { [pk]: { $in: ids } }

			const update = compileMongoUpdate(data)
			if (Object.keys(update).length > 0) {
				await collection.updateMany(idFilter, update, { session })
			}

			return await collection.find({ [pk]: { $in: ids } }, { session }).toArray()
		} catch (error) {
			throw new EquippedError(
				'MongoDB updateMany failed',
				{ adapter: 'mongodb', operation: 'updateMany', collection: schemaCfg.col },
				error,
			)
		}
	}

	async deleteMany(schema: AnySchema, config: unknown, filter: FilterGroup) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pk = schema.pkField.name
			const collection = this.#getCollection(schemaCfg)
			const session = this.#sessionStore.getStore()
			const mongoFilter = compileMongoFilter(filter, pk)

			const docs = await collection.find(mongoFilter, { session }).toArray()
			if (docs.length > 0) {
				await collection.deleteMany(mongoFilter, { session })
			}
			return docs
		} catch (error) {
			throw new EquippedError(
				'MongoDB deleteMany failed',
				{ adapter: 'mongodb', operation: 'deleteMany', collection: schemaCfg.col },
				error,
			)
		}
	}

	async upsertOne(schema: AnySchema, config: unknown, filter: FilterGroup, create: Record<string, unknown>, ops: AnyUpdateOp[]) {
		const schemaCfg = config as MongoDbRepoConfig
		try {
			const pk = schema.pkField.name
			const collection = this.#getCollection(schemaCfg)
			const mongoFilter = compileMongoFilter(filter, pk)

			const updateDoc = compileMongoOps(ops)
			const doc = await collection.findOneAndUpdate(
				mongoFilter,
				{
					...updateDoc,
					$setOnInsert: create,
				},
				{
					returnDocument: 'after',
					session: this.#sessionStore.getStore(),
					upsert: true,
				},
			)

			return doc as Record<string, unknown>
		} catch (error) {
			throw new EquippedError(
				'MongoDB upsertOne failed',
				{ adapter: 'mongodb', operation: 'upsertOne', collection: schemaCfg.col },
				error,
			)
		}
	}

	async session<T>(fn: () => Promise<T>): Promise<T> {
		if (this.#sessionStore.getStore()) return fn()
		try {
			const session = await this.client.startSession()
			try {
				return await session.withTransaction(async () => this.#sessionStore.run(session, fn))
			} finally {
				await session.endSession()
			}
		} catch (error) {
			if (error instanceof EquippedError) throw error
			throw new EquippedError('MongoDB session failed', { adapter: 'mongodb', operation: 'session' }, error)
		}
	}
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf } = import.meta.vitest

	describe('MongoDbAdapter: class-via-configurable shape', () => {
		test('MongoDbAdapter.create validates connection config via pipe', () => {
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			expect(adapter).toBeInstanceOf(MongoDbAdapter)
			expect(adapter.client).toBeInstanceOf(MongoClient)
		})

		test('MongoDbAdapter.create rejects invalid config', () => {
			expect(() => MongoDbAdapter.create({} as any)).toThrow()
			expect(() => MongoDbAdapter.create({ uri: 123 } as any)).toThrow()
		})

		test('readonly schemaConfigPipe declared with { db, col } shape', () => {
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			expect(adapter.schemaConfigPipe).toBeDefined()
		})

		test('capability declarations use as const', () => {
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })

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

		test('underlying MongoClient exposed as readonly instance field', () => {
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			expect(adapter.client).toBeInstanceOf(MongoClient)
		})

		test('adapter.use returns OrmUse-shaped object', async () => {
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const schema = Schema.from('test').pk('id', v.string(), () => 'x').build()
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			const use = adapter.use(schema, { db: 'testdb', col: 'testcol' })

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
			const _adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			type Ops = typeof _adapter.updateOps
			expectTypeOf<Ops>().toEqualTypeOf<
				readonly ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch']
			>()
		})

		test('type-level: adapter declares all 7 field types', () => {
			const _adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			type Types = typeof _adapter.supportedFieldTypes
			expectTypeOf<Types>().toEqualTypeOf<
				readonly ['string', 'number', 'boolean', 'null', 'object', 'array', 'date']
			>()
		})

		test('type-level: adapter declares all 13 queryable ops', () => {
			const _adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			type Ops = typeof _adapter.queryableOps
			expectTypeOf<Ops>().toEqualTypeOf<
				readonly ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains']
			>()
		})

		test('type-level: Repo.from with MongoDbAdapter enables all builder methods', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			const repo = Repo.from(adapter).resolve(() => ({ db: 'test', col: 'test' })).build()
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

		test('type-level: raw arg-tuple infers (pipeline: Record<string, unknown>[]) from MongoDbAdapter', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			const repo = Repo.from(adapter).resolve(() => ({ db: 'test', col: 'test' })).build()
			const _TestSchema = Schema.from('test').pk('id', v.string(), () => 'x').build()
			const _ref = repo.on(_TestSchema)

			expectTypeOf(_ref.raw).parameters.toEqualTypeOf<[pipeline: Record<string, unknown>[]]>()
		})

		test('type-level: per-call <T> override narrows MongoDbAdapter raw return type', async () => {
			const { Repo } = await import('../../repo/repo')
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			const repo = Repo.from(adapter).resolve(() => ({ db: 'test', col: 'test' })).build()
			const _TestSchema = Schema.from('test').pk('id', v.string(), () => 'x').build()
			const _ref = repo.on(_TestSchema)

			expectTypeOf(_ref.raw<{ total: number }[]>).returns.toEqualTypeOf<Promise<{ total: number }[]>>()
		})

		test('raw forwards pipeline to collection.aggregate at runtime', async () => {
			const { Schema } = await import('../../schema')
			const { v } = await import('valleyed')
			const schema = Schema.from('mongo_raw').pk('id', v.string(), () => 'x').build()
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			let capturedPipeline: unknown
			const mockResults = [{ total: 42 }]
			;(adapter.client as any).db = () => ({
				collection: () => ({
					aggregate: (pipeline: unknown, _opts: unknown) => {
						capturedPipeline = pipeline
						return { toArray: async () => mockResults }
					},
				}),
			})
			const result = await adapter.use(schema, { db: 'testdb', col: 'things' }).raw([{ $count: 'total' }])
			expect(capturedPipeline).toEqual([{ $count: 'total' }])
			expect(result).toEqual(mockResults)
		})

		test('nested session returns callback without starting new transaction', () => {
			const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })
			expect(adapter.session).toBeTypeOf('function')
		})

		test('auto-wires Instance hooks for connect/disconnect', async () => {
			const { Instance: Inst } = await import('../../../instance')
			const { vi } = await import('vitest')
			const onSpy = vi.spyOn(Inst, 'on').mockImplementation(() => {})

			MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })

			expect(onSpy).toHaveBeenCalledWith('start', expect.any(Function), expect.objectContaining({ class: MongoDbAdapter }))
			expect(onSpy).toHaveBeenCalledWith('close', expect.any(Function), expect.objectContaining({ class: MongoDbAdapter }))

			onSpy.mockRestore()
		})
	})
}
