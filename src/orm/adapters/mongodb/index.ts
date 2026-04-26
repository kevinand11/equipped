import { AsyncLocalStorage } from 'node:async_hooks'

import { MongoClient, type ClientSession, type OptionalUnlessRequiredId } from 'mongodb'
import { v, type PipeOutput } from 'valleyed'

import { compileMongoQuery, compileMongoUpdate } from './query'
import { EquippedError } from '../../../errors'
import { configurable } from '../../../utilities'
import type { AnySchema } from '../../schema'
import { OrmAdapter, type OrmUse } from '../base'

const sessionStore = new AsyncLocalStorage<ClientSession | undefined>()

export const mongoDbOrmConfigPipe = () =>
	v.object({
		host: v.string(),
		port: v.number().pipe(v.int(), v.gt(0)),
		username: v.optional(v.string()),
		password: v.optional(v.string()),
		ssl: v.defaults(v.boolean(), false),
		authSource: v.optional(v.string()),
	})

export type MongoDbRepoConfig = {
	db: string
	col: string
}

export class MongoDbOrm extends configurable(
	mongoDbOrmConfigPipe,
	class extends OrmAdapter<MongoDbRepoConfig> {
		_client: MongoClient
		constructor(config: PipeOutput<ReturnType<typeof mongoDbOrmConfigPipe>>) {
			super()
			const protocol = config.ssl ? 'mongodb+srv' : 'mongodb'
			const host = config.ssl ? config.host : `${config.host}:${config.port}`
			this._client = new MongoClient(`${protocol}://${host}`, {
				auth: config.username || config.password ? { username: config.username, password: config.password } : undefined,
				authSource: config.authSource,
				tls: config.ssl,
				ignoreUndefined: true,
			})
		}
		async connect() {
			try {
				await this._client.connect()
			} catch (error) {
				throw new EquippedError('Failed to connect MongoDB client', { adapter: 'mongodb' }, error)
			}
		}
		async disconnect() {
			try {
				await this._client.close()
			} catch (error) {
				throw new EquippedError('Failed to disconnect MongoDB client', { adapter: 'mongodb' }, error)
			}
		}
		use(schema: AnySchema, config: MongoDbRepoConfig) {
			const pk = schema.pkField.name
			const collection = this._client.db(config.db).collection(config.col)
			const use: OrmUse = {
				findMany: async (filter, options) => {
					try {
						const { filter: mongoFilter, sort, limit, skip, projection } = compileMongoQuery(filter, options, pk)

						let cursor = collection.find(mongoFilter, {
							session: sessionStore.getStore(),
							projection,
						})
						if (sort) cursor = cursor.sort(sort)
						if (limit) cursor = cursor.limit(limit)
						if (skip) cursor = cursor.skip(skip)

						return cursor.toArray()
					} catch (error) {
						throw new EquippedError(
							'MongoDB findMany failed',
							{ adapter: 'mongodb', operation: 'findMany', collection: config.col },
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
							'MongoDB findOne failed',
							{ adapter: 'mongodb', operation: 'findOne', collection: config.col },
							error,
						)
					}
				},
				insertMany: async (data) => {
					try {
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
				insertOne: async (data) => {
					try {
						const results = await use.insertMany([data])
						return results[0]
					} catch (error) {
						throw new EquippedError(
							'MongoDB insertOne failed',
							{ adapter: 'mongodb', operation: 'insertOne', collection: config.col },
							error,
						)
					}
				},
				updateMany: async (filter, data) => {
					try {
						const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
						const now = new Date()
						const session = sessionStore.getStore()

						const matchingDocs = await collection.find(mongoFilter, { session, projection: { [pk]: 1 } }).toArray()
						const ids = matchingDocs.map((d) => d[pk])
						const idFilter = { [pk]: { $in: ids } }

						const update = compileMongoUpdate(data, filter.raws, now)
						await collection.updateMany(idFilter, update, { session })

						const cursor = collection.find({ [pk]: { $in: ids } }, { session })
						return cursor.toArray()
					} catch (error) {
						throw new EquippedError(
							'MongoDB updateMany failed',
							{ adapter: 'mongodb', operation: 'updateMany', collection: config.col },
							error,
						)
					}
				},
				updateOne: async (filter, data) => {
					try {
						const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
						const now = new Date()

						const update = compileMongoUpdate(data, filter.raws, now)
						return await collection.findOneAndUpdate(mongoFilter, update, {
							returnDocument: 'after',
							session: sessionStore.getStore(),
						})
					} catch (error) {
						throw new EquippedError(
							'MongoDB updateOne failed',
							{ adapter: 'mongodb', operation: 'updateOne', collection: config.col },
							error,
						)
					}
				},
				upsertOne: async (filter, data) => {
					try {
						const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
						const now = new Date()

						const updateData = 'update' in data ? data.update : {}
						const updateOp = compileMongoUpdate(updateData, filter.raws, now)

						const doc = await collection.findOneAndUpdate(
							mongoFilter,
							{
								...updateOp,
								$setOnInsert: data.insert,
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
				deleteMany: async (filter) => {
					try {
						const docs = await use.findMany(filter)
						const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
						await collection.deleteMany(mongoFilter, { session: sessionStore.getStore() })
						return docs
					} catch (error) {
						throw new EquippedError(
							'MongoDB deleteMany failed',
							{ adapter: 'mongodb', operation: 'deleteMany', collection: config.col },
							error,
						)
					}
				},
				deleteOne: async (filter) => {
					try {
						const doc = await use.findOne(filter)
						if (!doc) return null
						const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
						await collection.deleteOne(mongoFilter, { session: sessionStore.getStore() })
						return doc
					} catch (error) {
						throw new EquippedError(
							'MongoDB deleteOne failed',
							{ adapter: 'mongodb', operation: 'deleteOne', collection: config.col },
							error,
						)
					}
				},
				raw: async <T = unknown>(command) => {
					try {
						if (!command || typeof command !== 'object') {
							throw new EquippedError('MongoDB raw requires a command object', {
								adapter: 'mongodb',
								operation: 'raw',
								collection: config.col,
							})
						}
						const result = await collection.aggregate(command as any, { session: sessionStore.getStore() }).toArray()
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
			}
			return use
		}

		async session<T>(callback: () => Promise<T>): Promise<T> {
			if (sessionStore.getStore()) return callback()
			try {
				const session = await this._client.startSession()
				return session.withTransaction(async () => sessionStore.run(session, callback))
			} catch (error) {
				throw new EquippedError('MongoDB session failed', { adapter: 'mongodb', operation: 'session' }, error)
			}
		}
	},
) {}
