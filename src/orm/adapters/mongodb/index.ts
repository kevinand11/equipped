import { AsyncLocalStorage } from 'node:async_hooks'

import { MongoClient, type ClientSession, type OptionalUnlessRequiredId } from 'mongodb'

import { compileMongoFilter, compileMongoOps, compileMongoQuery, compileMongoUpdate } from './query'
import { EquippedError } from '../../../errors'
import { defineAdapter } from '../../adapter'
import type { FilterGroup } from '../../filter'
import type { QueryOptions } from '../../query'
import type { AnySchema } from '../../schema'
import type { AnyUpdateOp } from '../../updates'

export type MongoDbRepoConfig = {
	db: string
	col: string
}

export type MongoDbConnectionConfig = {
	host: string
	port: number
	username?: string
	password?: string
	ssl?: boolean
	authSource?: string
}

const sessionStore = new AsyncLocalStorage<ClientSession | undefined>()

export function createMongoAdapter(connectionConfig: MongoDbConnectionConfig) {
	const protocol = connectionConfig.ssl ? 'mongodb+srv' : 'mongodb'
	const host = connectionConfig.ssl ? connectionConfig.host : `${connectionConfig.host}:${connectionConfig.port}`
	const client = new MongoClient(`${protocol}://${host}`, {
		auth:
			connectionConfig.username || connectionConfig.password
				? { username: connectionConfig.username, password: connectionConfig.password }
				: undefined,
		authSource: connectionConfig.authSource,
		tls: connectionConfig.ssl ?? false,
		ignoreUndefined: true,
	})

	function getCollection(config: MongoDbRepoConfig) {
		return client.db(config.db).collection(config.col)
	}

	const adapter = defineAdapter((a) =>
		a
			.config({} as MongoDbRepoConfig)
			.supportedFieldTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
			.queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains')
			.updateOps('set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch')
			.lifecycle({
				connect: async () => {
					try {
						await client.connect()
					} catch (error) {
						throw new EquippedError('Failed to connect MongoDB client', { adapter: 'mongodb' }, error)
					}
				},
				disconnect: async () => {
					try {
						await client.close()
					} catch (error) {
						throw new EquippedError('Failed to disconnect MongoDB client', { adapter: 'mongodb' }, error)
					}
				},
			})
			.crud({
				findByPk: async (schema, config, pk) => {
					try {
						const pkName = schema.pkField.name
						const collection = getCollection(config)
						const doc = await collection.findOne(
							{ [pkName]: pk },
							{ session: sessionStore.getStore() },
						)
						return doc as Record<string, unknown> | null
					} catch (error) {
						throw new EquippedError(
							'MongoDB findByPk failed',
							{ adapter: 'mongodb', operation: 'findByPk', collection: config.col },
							error,
						)
					}
				},
				insertMany: async (_schema, config, data) => {
					try {
						const collection = getCollection(config)
						const docs = data.map((d) => d as OptionalUnlessRequiredId<any>)
						await collection.insertMany(docs, { session: sessionStore.getStore() })
						return data
					} catch (error) {
						throw new EquippedError(
							'MongoDB insertMany failed',
							{ adapter: 'mongodb', operation: 'insertMany', collection: config.col },
							error,
						)
					}
				},
				updateByPk: async (schema, config, pk, ops) => {
					try {
						const pkName = schema.pkField.name
						const collection = getCollection(config)
						const update = compileMongoOps(ops)
						if (Object.keys(update).length === 0) {
							return await collection.findOne({ [pkName]: pk }, { session: sessionStore.getStore() }) as Record<string, unknown> | null
						}
						return await collection.findOneAndUpdate(
							{ [pkName]: pk },
							update,
							{ returnDocument: 'after', session: sessionStore.getStore() },
						) as Record<string, unknown> | null
					} catch (error) {
						throw new EquippedError(
							'MongoDB updateByPk failed',
							{ adapter: 'mongodb', operation: 'updateByPk', collection: config.col },
							error,
						)
					}
				},
				deleteByPk: async (schema, config, pk) => {
					try {
						const pkName = schema.pkField.name
						const collection = getCollection(config)
						return await collection.findOneAndDelete(
							{ [pkName]: pk },
							{ session: sessionStore.getStore() },
						) as Record<string, unknown> | null
					} catch (error) {
						throw new EquippedError(
							'MongoDB deleteByPk failed',
							{ adapter: 'mongodb', operation: 'deleteByPk', collection: config.col },
							error,
						)
					}
				},
				raw: async <T = unknown>(_schema: AnySchema, config: MongoDbRepoConfig, command: unknown) => {
					try {
						const collection = getCollection(config)
						if (!command || typeof command !== 'object') {
							throw new EquippedError('MongoDB raw requires a command object', {
								adapter: 'mongodb',
								operation: 'raw',
								collection: config.col,
							})
						}
						const result = await collection.aggregate(command as any[], { session: sessionStore.getStore() }).toArray()
						return result as T
					} catch (error) {
						if (error instanceof EquippedError) throw error
						throw new EquippedError(
							'MongoDB raw failed',
							{ adapter: 'mongodb', operation: 'raw', collection: config.col },
							error,
						)
					}
				},
			})
			.queryable({
				findMany: async (schema: AnySchema, config: MongoDbRepoConfig, filter: FilterGroup, options?: QueryOptions) => {
					try {
						const pk = schema.pkField.name
						const { filter: mongoFilter, sort, limit, skip, projection } = compileMongoQuery(filter, options, pk)
						const collection = getCollection(config)

						let cursor = collection.find(mongoFilter, {
							session: sessionStore.getStore(),
							projection,
						})
						if (sort) cursor = cursor.sort(sort)
						if (limit) cursor = cursor.limit(limit)
						if (skip) cursor = cursor.skip(skip)

						return await cursor.toArray()
					} catch (error) {
						throw new EquippedError(
							'MongoDB findMany failed',
							{ adapter: 'mongodb', operation: 'findMany', collection: config.col },
							error,
						)
					}
				},
				updateMany: async (schema: AnySchema, config: MongoDbRepoConfig, filter: FilterGroup, data: Record<string, unknown>) => {
					try {
						const pk = schema.pkField.name
						const collection = getCollection(config)
						const session = sessionStore.getStore()
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
							{ adapter: 'mongodb', operation: 'updateMany', collection: config.col },
							error,
						)
					}
				},
				deleteMany: async (schema: AnySchema, config: MongoDbRepoConfig, filter: FilterGroup) => {
					try {
						const pk = schema.pkField.name
						const collection = getCollection(config)
						const session = sessionStore.getStore()
						const mongoFilter = compileMongoFilter(filter, pk)

						const docs = await collection.find(mongoFilter, { session }).toArray()
						if (docs.length > 0) {
							await collection.deleteMany(mongoFilter, { session })
						}
						return docs
					} catch (error) {
						throw new EquippedError(
							'MongoDB deleteMany failed',
							{ adapter: 'mongodb', operation: 'deleteMany', collection: config.col },
							error,
						)
					}
				},
				upsertOne: async (schema: AnySchema, config: MongoDbRepoConfig, filter: FilterGroup, insert: Record<string, unknown>, ops: AnyUpdateOp[]) => {
					try {
						const pk = schema.pkField.name
						const collection = getCollection(config)
						const mongoFilter = compileMongoFilter(filter, pk)

						const updateDoc = compileMongoOps(ops)
						const doc = await collection.findOneAndUpdate(
							mongoFilter,
							{
								...updateDoc,
								$setOnInsert: insert,
							},
							{
								returnDocument: 'after',
								session: sessionStore.getStore(),
								upsert: true,
							},
						)

						return doc as Record<string, unknown>
					} catch (error) {
						throw new EquippedError(
							'MongoDB upsertOne failed',
							{ adapter: 'mongodb', operation: 'upsertOne', collection: config.col },
							error,
						)
					}
				},
			})
			.transactional({
				session: async <T>(fn: () => Promise<T>): Promise<T> => {
					if (sessionStore.getStore()) return fn()
					try {
						const session = await client.startSession()
						try {
							return await session.withTransaction(async () => sessionStore.run(session, fn))
						} finally {
							await session.endSession()
						}
					} catch (error) {
						if (error instanceof EquippedError) throw error
						throw new EquippedError('MongoDB session failed', { adapter: 'mongodb', operation: 'session' }, error)
					}
				},
			}),
	)

	return { adapter, client }
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf } = import.meta.vitest

	describe('mongodb adapter: defineAdapter shape', () => {
		test('createMongoAdapter returns adapter with correct capability declarations', () => {
			const { adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })

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
			const { adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })

			expect(adapter.lifecycle).toBeDefined()
			expect(adapter.lifecycle!.connect).toBeTypeOf('function')
			expect(adapter.lifecycle!.disconnect).toBeTypeOf('function')

			expect(adapter.crud).toBeDefined()
			expect(adapter.crud!.findByPk).toBeTypeOf('function')
			expect(adapter.crud!.insertMany).toBeTypeOf('function')
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
			const { defineSchema } = await import('../../schema')
			const { v } = await import('valleyed')
			const schema = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x'))
			const { adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })
			const use = adapter.use(schema, { db: 'testdb', col: 'testcol' })

			expect(use.findMany).toBeTypeOf('function')
			expect(use.findOne).toBeTypeOf('function')
			expect(use.insertOne).toBeTypeOf('function')
			expect(use.insertMany).toBeTypeOf('function')
			expect(use.updateMany).toBeTypeOf('function')
			expect(use.updateOne).toBeTypeOf('function')
			expect(use.upsertOne).toBeTypeOf('function')
			expect(use.deleteOne).toBeTypeOf('function')
			expect(use.deleteMany).toBeTypeOf('function')
			expect(use.raw).toBeTypeOf('function')
		})

		test('type-level: adapter declares all 9 canonical update ops', () => {
			const { adapter: _adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })
			type Ops = typeof _adapter.updateOps
			expectTypeOf<Ops>().toEqualTypeOf<
				readonly ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch']
			>()
		})

		test('type-level: adapter declares all 7 field types', () => {
			const { adapter: _adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })
			type Types = typeof _adapter.supportedFieldTypes
			expectTypeOf<Types>().toEqualTypeOf<
				readonly ['string', 'number', 'boolean', 'null', 'object', 'array', 'date']
			>()
		})

		test('type-level: adapter declares all 13 queryable ops', () => {
			const { adapter: _adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })
			type Ops = typeof _adapter.queryableOps
			expectTypeOf<Ops>().toEqualTypeOf<
				readonly ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains']
			>()
		})

		test('type-level: defineRepo with mongo adapter enables all methods', async () => {
			const { defineRepo } = await import('../../repo/repo')
			const { adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })
			const repo = defineRepo((r) => r.adapter(adapter).resolve(() => ({ db: 'test', col: 'test' })))

			expectTypeOf(repo.findByPk).toBeFunction()
			expectTypeOf(repo.findMany).toBeFunction()
			expectTypeOf(repo.findOne).toBeFunction()
			expectTypeOf(repo.insertOne).toBeFunction()
			expectTypeOf(repo.insertMany).toBeFunction()
			expectTypeOf(repo.updateByPk).toBeFunction()
			expectTypeOf(repo.updateOne).toBeFunction()
			expectTypeOf(repo.updateMany).toBeFunction()
			expectTypeOf(repo.deleteByPk).toBeFunction()
			expectTypeOf(repo.deleteOne).toBeFunction()
			expectTypeOf(repo.deleteMany).toBeFunction()
			expectTypeOf(repo.upsertOne).toBeFunction()
			expectTypeOf(repo.session).toBeFunction()
			expectTypeOf(repo.raw).toBeFunction()
		})

		test('nested session returns callback without starting new transaction', () => {
			const { adapter } = createMongoAdapter({ host: 'localhost', port: 27017 })
			expect(adapter.transactional!.session).toBeDefined()
		})
	})
}
