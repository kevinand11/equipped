import { AsyncLocalStorage } from 'node:async_hooks'

import { MongoClient, type ClientSession, type OptionalUnlessRequiredId } from 'mongodb'
import { v, type PipeOutput } from 'valleyed'

import { configurable } from '../../../utilities'
import type { AnySchema } from '../../schema/types'
import { Orm, type OrmUse } from '../base'
import { compileMongoQuery, compileMongoUpdate } from './query'

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
	class extends Orm<MongoDbRepoConfig> {
		#client: MongoClient
		constructor(config: PipeOutput<ReturnType<typeof mongoDbOrmConfigPipe>>) {
			super()
			const protocol = config.ssl ? 'mongodb+srv' : 'mongodb'
			const host = config.ssl ? config.host : `${config.host}:${config.port}`
			this.#client = new MongoClient(`${protocol}://${host}`, {
				auth: config.username || config.password ? { username: config.username, password: config.password } : undefined,
				authSource: config.authSource,
				tls: config.ssl,
				ignoreUndefined: true,
			})
		}
		async connect() {
			await this.#client.connect()
		}
		async disconnect() {
			await this.#client.close()
		}
		use(schema: AnySchema, config: MongoDbRepoConfig) {
			const collection = this.#client.db(config.db).collection(config.col)
			const use: OrmUse = {
				findMany: async (queryAst) => {
					const { filter, sort, limit, skip, projection } = compileMongoQuery(queryAst, schema.primaryKey)

					let cursor = collection.find(filter, {
						session: sessionStore.getStore(),
						projection,
					})
					if (sort) cursor = cursor.sort(sort)
					if (limit) cursor = cursor.limit(limit)
					if (skip) cursor = cursor.skip(skip)

					return cursor.toArray()
				},
				findOne: async (queryAst) => {
					const results = await use.findMany({ ...queryAst, limit: 1 })
					return results[0] ?? null
				},
				insertMany: async (data, options) => {
					const now = options?.getTime?.() ?? new Date()
					const docs = data.map((d, i) => {
						const id = schema.generateId(i)
						const doc = {
							...d,
							[schema.primaryKey]: id,
							createdAt: now.getTime(),
							updatedAt: now.getTime(),
						}
						return doc as OptionalUnlessRequiredId<any>
					})
					await collection.insertMany(docs, { session: sessionStore.getStore() })
					return docs
				},
				insertOne: async (data, options) => {
					const results = await use.insertMany([data], options)
					return results[0]
				},
				updateMany: async (queryAst, data, options) => {
					const pk = schema.primaryKey
					const { filter } = compileMongoQuery(queryAst, pk)
					const now = options?.getTime?.() ?? new Date()
					const session = sessionStore.getStore()

					const matchingDocs = await collection.find(filter, { session, projection: { [pk]: 1 } }).toArray()
					const ids = matchingDocs.map((d) => d[pk])
					const idFilter = { [pk]: { $in: ids } }

					const update = compileMongoUpdate(data, queryAst.raws, now)
					await collection.updateMany(idFilter, update, { session })

					const cursor = collection.find({ [pk]: { $in: ids } }, { session })
					return cursor.toArray()
				},
				updateOne: async (queryAst, data, options) => {
					const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
					const now = options?.getTime?.() ?? new Date()

					const update = compileMongoUpdate(data, queryAst.raws, now)
					return await collection.findOneAndUpdate(filter, update, {
						returnDocument: 'after',
						session: sessionStore.getStore(),
					})
				},
				upsertOne: async (queryAst, data, options) => {
					const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
					const now = options?.getTime?.() ?? new Date()
					const id = schema.generateId(0)

					const updateData = 'update' in data ? data.update : {}
					const updateOp = compileMongoUpdate(updateData, queryAst.raws, now)

					const insertData = {
						...data.insert,
						[schema.primaryKey]: id,
						createdAt: now.getTime(),
					}

					const doc = await collection.findOneAndUpdate(
						filter,
						{
							...updateOp,
							$setOnInsert: insertData,
						},
						{
							returnDocument: 'after',
							session: sessionStore.getStore(),
							upsert: true,
						},
					)

					return doc as Record<string, unknown>
				},
				deleteMany: async (queryAst) => {
					const docs = await use.findMany(queryAst)
					const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
					await collection.deleteMany(filter, { session: sessionStore.getStore() })
					return docs
				},
				deleteOne: async (queryAst) => {
					const doc = await use.findOne(queryAst)
					if (!doc) return null
					const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
					await collection.deleteOne(filter, { session: sessionStore.getStore() })
					return doc
				},
				query: async (queryAst, pagination) => {
					const { filter, sort, projection } = compileMongoQuery(queryAst, schema.primaryKey)

					const total = await collection.countDocuments(filter)

					let cursor = collection.find(filter, { session: sessionStore.getStore(), projection })
					if (sort) cursor = cursor.sort(sort)
					if (!pagination.all && pagination.limit) {
						cursor = cursor.limit(pagination.limit)
						if (pagination.page) cursor = cursor.skip((pagination.page - 1) * pagination.limit)
					}

					const docs = await cursor.toArray()
					const results = docs.map((d) => d as Record<string, unknown>)

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

		async session<T>(callback: () => Promise<T>): Promise<T> {
			if (sessionStore.getStore()) return callback()
			const session = await this.#client.startSession()
			return session.withTransaction(async () => sessionStore.run(session, callback))
		}
	},
) {}
