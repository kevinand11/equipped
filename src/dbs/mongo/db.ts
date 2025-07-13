import { AsyncLocalStorage } from 'node:async_hooks'

import { ClientSession, Collection, CollectionInfo, MongoClient, ObjectId, OptionalUnlessRequiredId, SortDirection, WithId } from 'mongodb'

import { MongoDbConfig, QueryParams } from '../pipes'
import { MongoDbChange } from './changes'
import { parseMongodbQueryParams } from './query'
import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import * as core from '../base/core'
import { Db } from '../base/db'
import { DbConfig } from '../base/types'

const idKey = '_id'
type IdType = { _id: string }

const sessionStore = new AsyncLocalStorage<ClientSession | undefined>(undefined)

export class MongoDb extends Db<{ _id: string }> {
	client: MongoClient
	#cols: { db: string; col: string }[] = []

	constructor(
		private mongoConfig: MongoDbConfig,
		dbConfig: DbConfig,
	) {
		super(dbConfig)
		this.client = new MongoClient(mongoConfig.uri)
		Instance.on(
			'start',
			async () => {
				await this.client.connect()

				const grouped = this.#cols.reduce<Record<string, string[]>>((acc, cur) => {
					if (!acc[cur.db]) acc[cur.db] = []
					acc[cur.db].push(cur.col)
					return acc
				}, {})

				const options = {
					changeStreamPreAndPostImages: { enabled: true },
				}
				await Promise.all(
					Object.entries(grouped).map(async ([dbName, colNames]) => {
						const db = this.client.db(dbName)
						const collections = await db.listCollections<CollectionInfo>().toArray()
						return colNames.map(async (colName) => {
							const existing = collections.find((collection) => collection.name === colName)
							if (existing) {
								if (
									existing.options?.changeStreamPreAndPostImages?.enabled !== options.changeStreamPreAndPostImages.enabled
								)
									await db.command({ collMod: colName, ...options })
							} else await db.createCollection(colName, options)
						})
					}),
				)
			},
			3,
		)
		Instance.on('close', async () => this.client.close(), 1)
	}

	async session<T>(callback: () => Promise<T>) {
		return this.client.withSession(async (session) => sessionStore.run(session, callback))
	}

	id() {
		return new ObjectId()
	}

	use<Model extends core.Model<{ _id: string }>, Entity extends core.Entity>(config: core.Config<Model, Entity>) {
		const db = this.getScopedDb(config.db)
		this.#cols.push({ db, col: config.col })
		return this.#getTable(config, this.client.db(db).collection<Model>(config.col))
	}

	#getTable<Model extends core.Model<IdType>, Entity extends core.Entity>(
		config: core.Config<Model, Entity>,
		collection: Collection<Model>,
	) {
		type WI = Model | WithId<Model>
		async function transform(doc: WI): Promise<Entity>
		// eslint-disable-next-line no-redeclare
		async function transform(doc: WI[]): Promise<Entity[]>
		// eslint-disable-next-line no-redeclare
		async function transform(doc: WI | WI[]) {
			const docs = Array.isArray(doc) ? doc : [doc]
			const mapped = docs.map((d) => config.mapper(d as Model))
			return Array.isArray(doc) ? mapped : mapped[0]
		}

		function prepInsertValue(value: core.CreateInput<Model>, id: string, now: Date, skipUpdate?: boolean) {
			const base: core.Model<IdType> = {
				[idKey]: id,
				...(config.options?.skipAudit
					? {}
					: {
							createdAt: now.getTime(),
							...(skipUpdate ? {} : { updatedAt: now.getTime() }),
						}),
			}
			return {
				...value,
				...base,
			} as unknown as OptionalUnlessRequiredId<Model>
		}

		function prepUpdateValue(value: core.UpdateInput<Model>, now: Date, upsert = false) {
			return {
				...value,
				$set: {
					...value.$set,
					...(upsert || (Object.keys(value).length > 0 && !config.options?.skipAudit) ? { updatedAt: now.getTime() } : {}),
				},
			}
		}

		const dbThis = this

		const table: core.Table<IdType, Model, Entity, { collection: Collection<Model> }> = {
			config,
			extras: { collection },

			query: async (params: QueryParams) => {
				const results = await parseMongodbQueryParams(collection, params)
				return {
					...results,
					results: (await transform(results.results as any)) as any,
				}
			},

			findMany: async (filter, options = {}) => {
				const sortArray = Array.isArray(options.sort) ? options.sort : options.sort ? [options.sort] : []
				const sort = sortArray.map((p) => [p.field, p.desc ? 'desc' : 'asc'] as [string, SortDirection])
				const docs = await collection
					.find(filter, {
						session: sessionStore.getStore(),
						limit: options.limit,
						sort,
					})
					.toArray()
				return transform(docs)
			},

			findOne: async (filter) => {
				const result = await table.findMany(filter, { limit: 1 })
				return result.at(0) ?? null
			},

			findById: async (id) => {
				const result = await table.findOne({ [idKey]: id } as core.Filter<Model>)
				return result
			},

			insertMany: async (values, options = {}) => {
				const now = options.getTime?.() ?? new Date()
				const payload = values.map((value, i) => prepInsertValue(value, options.makeId?.(i) ?? new ObjectId().toString(), now))
				await collection.insertMany(payload, { session: sessionStore.getStore() })

				const insertedData = await Promise.all(payload.map(async (data) => await table.findById(data[idKey] as any)))
				return insertedData.filter((value) => !!value)
			},

			insertOne: async (values, options = {}) => {
				const result = await table.insertMany([values], options)
				return result[0]
			},

			updateMany: async (filter, values, options = {}) => {
				const now = options.getTime?.() ?? new Date()
				const session = sessionStore.getStore()
				const data = await collection.find(filter, { session, projection: { [idKey]: 1 } }).toArray()
				const ids = data.map((doc) => doc[idKey])
				const filterUpd = { [idKey]: { $in: ids } } as core.Filter<Model>
				await collection.updateMany(filterUpd, prepUpdateValue(values, now), { session })
				return table.findMany(filterUpd)
			},

			updateOne: async (filter, values, options = {}) => {
				const now = options.getTime?.() ?? new Date()
				const doc = await collection.findOneAndUpdate(filter, prepUpdateValue(values, now), {
					returnDocument: 'after',
					session: sessionStore.getStore(),
				})
				return doc ? transform(doc) : null
			},

			updateById: async (id, values, options = {}) => {
				const result = await table.updateOne({ [idKey]: id } as core.Filter<Model>, values, options)
				return result
			},

			upsertOne: async (filter, values, options = {}) => {
				const now = options.getTime?.() ?? new Date()

				const doc = await collection.findOneAndUpdate(
					filter,
					{
						...prepUpdateValue('update' in values ? values.update : {}, now, true),
						// @ts-expect-error fighting ts
						$setOnInsert: prepInsertValue(values.insert, options.makeId?.() ?? new ObjectId().toString(), now, true),
					},
					{ returnDocument: 'after', session: sessionStore.getStore(), upsert: true },
				)

				return transform(doc)
			},

			deleteMany: async (filter, options = {}) => {
				const docs = await table.findMany(filter, options)
				await collection.deleteMany(filter, { session: sessionStore.getStore() })
				return docs
			},

			deleteOne: async (filter) => {
				const doc = await collection.findOneAndDelete(filter, { session: sessionStore.getStore() })
				return doc ? transform(doc) : null
			},

			deleteById: async (id) => {
				const result = await table.deleteOne({ [idKey]: id } as core.Filter<Model>)
				return result
			},

			bulkWrite: async (operations, options = {}) => {
				const bulk = collection.initializeUnorderedBulkOp({ session: sessionStore.getStore() })
				const now = options.getTime?.() ?? new Date()
				operations.forEach((operation, i) => {
					switch (operation.op) {
						case 'insert':
							bulk.insert(prepInsertValue(operation.value, operation.makeId?.(i) ?? new ObjectId().toString(), now))
							break
						case 'delete':
							bulk.find(operation.filter).delete()
							break
						case 'update':
							bulk.find(operation.filter).update(prepUpdateValue(operation.value, now))
							break
						case 'upsert':
							bulk.find(operation.filter)
								.upsert()
								.update({
									...prepUpdateValue('update' in operation ? operation.update : {}, now, true),
									$setOnInsert: prepInsertValue(
										operation.insert as any,
										operation.makeId?.(i) ?? new ObjectId().toString(),
										now,
										true,
									),
								})
							break
						default:
							throw new EquippedError(`Unknown bulkWrite operation`, { operation })
					}
				})
				await bulk.execute({ session: sessionStore.getStore() })
			},

			watch(callbacks) {
				if (!dbThis.config.changes)
					Instance.crash(new EquippedError('Db changes are not enabled in the configuration.', { config }))
				return new MongoDbChange<Model, Entity>(dbThis.mongoConfig, dbThis.config.changes, collection, callbacks, config.mapper)
			},
		}

		return table
	}
}
