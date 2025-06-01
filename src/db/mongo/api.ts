import { Collection, ObjectId, OptionalUnlessRequiredId, SortDirection, WithId } from 'mongodb'

import { Config } from '../_instance'
import * as core from '../core'
import { QueryParams } from '../query'
import { parseMongodbQueryParams } from './query'

const idKey = '_id'
type IdType = { _id: string }

export function getTable<Model extends core.Model<IdType>, Entity extends core.Entity>(
	collection: Collection<Model>,
	{ mapper, options: tableOptions = {} }: Config<Model, Entity>,
) {
	type WI = Model | WithId<Model>
	async function transform(doc: WI): Promise<Entity>
	// eslint-disable-next-line no-redeclare
	async function transform(doc: WI[]): Promise<Entity[]>
	// eslint-disable-next-line no-redeclare
	async function transform(doc: WI | WI[]) {
		const docs = Array.isArray(doc) ? doc : [doc]
		const mapped = docs.map((d) => mapper(d as Model))
		return Array.isArray(doc) ? mapped : mapped[0]
	}

	function prepInsertValue(value: core.CreateInput<Model>, id: string, now: Date, skipUpdate?: boolean) {
		const base: core.Model<any> = {
			[idKey]: id,
			...(tableOptions.skipAudit
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

	function prepUpdateValue(value: core.UpdateInput<Model>, now: Date) {
		return {
			...value,
			$set: {
				...value.$set,
				...(Object.keys(value).length > 0 && !tableOptions.skipAudit
					? {
							updatedAt: now.getTime(),
						}
					: {}),
			},
		}
	}

	const table: core.Table<IdType, Model, Entity, { collection: Collection<Model> }> = {
		extras: { collection },

		query: async (params: QueryParams) => {
			const results = await parseMongodbQueryParams(collection, params)
			return {
				...results,
				results: await transform(results.results),
			}
		},

		findMany: async (filter, options = {}) => {
			const sortArray = Array.isArray(options.sort) ? options.sort : options.sort ? [options.sort] : []
			const sort = sortArray.map((p) => [p.field, p.desc ? 'desc' : 'asc'] as [string, SortDirection])
			const docs = await collection
				.find(filter, {
					session: options.session,
					limit: options.limit,
					sort,
				})
				.toArray()
			return transform(docs)
		},

		findOne: async (filter, options = {}) => {
			const result = await table.findMany(filter, { ...options, limit: 1 })
			return result.at(0) ?? null
		},

		findById: async (id, options = {}) => {
			const result = await table.findOne({ [idKey]: id } as core.Filter<Model>, options)
			return result
		},

		insertMany: async (values, options = {}) => {
			const now = options.getTime?.() ?? new Date()
			const payload = values.map((value, i) => prepInsertValue(value, options.makeId?.(i) ?? new ObjectId().toString(), now))
			await collection.insertMany(payload, { session: options.session })

			const insertedData = await Promise.all(payload.map(async (data) => await table.findById(data[idKey] as any, options)))
			return insertedData.filter((value) => !!value)
		},

		insertOne: async (values, options = {}) => {
			const result = await table.insertMany([values], options)
			return result[0]
		},

		updateMany: async (filter, values, options = {}) => {
			const now = options.getTime?.() ?? new Date()
			await collection.updateMany(filter, prepUpdateValue(values, now), { session: options.session })
			return table.findMany(filter, options)
		},

		updateOne: async (filter, values, options = {}) => {
			const now = options.getTime?.() ?? new Date()
			const doc = await collection.findOneAndUpdate(filter, prepUpdateValue(values, now), {
				returnDocument: 'after',
				session: options.session,
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
					...prepUpdateValue('update' in values ? values.update : {}, now),
					// @ts-expect-error fighting ts
					$setOnInsert: prepInsertValue(values.insert, options.makeId?.() ?? new ObjectId().toString(), now, true),
				},
				{ returnDocument: 'after', session: options.session, upsert: true },
			)

			return transform(doc)
		},

		deleteMany: async (filter, options = {}) => {
			const docs = await table.findMany(filter, options)
			await collection.deleteMany(filter, { session: options.session })
			return docs
		},

		deleteOne: async (filter, options) => {
			const doc = await collection.findOneAndDelete(filter, { session: options?.session })
			return doc ? transform(doc) : null
		},

		deleteById: async (id, options) => {
			const result = await table.deleteOne({ [idKey]: id } as core.Filter<Model>, options)
			return result
		},

		bulkWrite: async (operations, options = {}) => {
			const bulk = collection.initializeUnorderedBulkOp({ session: options.session })
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
								...prepUpdateValue('update' in operation ? operation.update : {}, now),
								$setOnInsert: prepInsertValue(
									operation.insert as any,
									operation.makeId?.(i) ?? new ObjectId().toString(),
									now,
									true,
								),
							})
						break
					default:
						throw new Error(`Unknown bulkWrite operation`)
				}
			})
			await bulk.execute({ session: options.session })
		},
	}

	return table
}
