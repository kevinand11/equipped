import { AsyncLocalStorage } from 'node:async_hooks'

import { MongoClient, type ClientSession, type OptionalUnlessRequiredId } from 'mongodb'
import { v, type PipeOutput } from 'valleyed'

import { configurable } from '../../../utilities'
import type { AnySchema } from '../../schema'
import { OrmAdapter, type OrmUse } from '../base'
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
	class extends OrmAdapter<MongoDbRepoConfig> {
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
			const pk = schema.pkName
			const collection = this.#client.db(config.db).collection(config.col)
			const use: OrmUse = {
				findMany: async (filter, options) => {
					const { filter: mongoFilter, sort, limit, skip, projection } = compileMongoQuery(filter, options, pk)

					let cursor = collection.find(mongoFilter, {
						session: sessionStore.getStore(),
						projection,
					})
					if (sort) cursor = cursor.sort(sort)
					if (limit) cursor = cursor.limit(limit)
					if (skip) cursor = cursor.skip(skip)

					return cursor.toArray()
				},
				findOne: async (filter) => {
					const results = await use.findMany(filter, { limit: 1 })
					return results[0] ?? null
				},
				insertMany: async (data) => {
					const docs = data.map((d) => d as OptionalUnlessRequiredId<any>)
					await collection.insertMany(docs, { session: sessionStore.getStore() })
					return data
				},
				insertOne: async (data) => {
					const results = await use.insertMany([data])
					return results[0]
				},
				updateMany: async (filter, data) => {
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
				},
				updateOne: async (filter, data) => {
					const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
					const now = new Date()

					const update = compileMongoUpdate(data, filter.raws, now)
					return await collection.findOneAndUpdate(mongoFilter, update, {
						returnDocument: 'after',
						session: sessionStore.getStore(),
					})
				},
				upsertOne: async (filter, data) => {
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
				},
				deleteMany: async (filter) => {
					const docs = await use.findMany(filter)
					const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
					await collection.deleteMany(mongoFilter, { session: sessionStore.getStore() })
					return docs
				},
				deleteOne: async (filter) => {
					const doc = await use.findOne(filter)
					if (!doc) return null
					const { filter: mongoFilter } = compileMongoQuery(filter, undefined, pk)
					await collection.deleteOne(mongoFilter, { session: sessionStore.getStore() })
					return doc
				},
				paginatedQuery: async (filter, pagination) => {
					const { filter: mongoFilter, sort, projection } = compileMongoQuery(filter, undefined, pk)

					const total = await collection.countDocuments(mongoFilter)

					let cursor = collection.find(mongoFilter, { session: sessionStore.getStore(), projection })
					if (sort) cursor = cursor.sort(sort)
					if (!pagination.all && pagination.limit) {
						cursor = cursor.limit(pagination.limit)
						if (pagination.page) cursor = cursor.skip((pagination.page - 1) * pagination.limit)
					}

					const docs = await cursor.toArray()
					const results = docs.map((d) => d as Record<string, unknown>)

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

		async session<T>(callback: () => Promise<T>): Promise<T> {
			if (sessionStore.getStore()) return callback()
			const session = await this.#client.startSession()
			return session.withTransaction(async () => sessionStore.run(session, callback))
		}
	},
) {}
