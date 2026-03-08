import { AsyncLocalStorage } from 'node:async_hooks'

import { type ClientSession, type Collection, MongoClient, type OptionalUnlessRequiredId } from 'mongodb'

import type { QueryAST } from '../../query/types'
import type { AnySchema } from '../../schema/types'
import type { Adapter, InsertOptions, PaginatedResult, UpdateOptions, UpsertOptions } from '../types'
import { compileMongoQuery, compileMongoUpdate } from './query-compiler'

const sessionStore = new AsyncLocalStorage<ClientSession | undefined>()

export type MongoAdapterConfig = {
	uri: string
}

export type MongoTableConfig = {
	db: string
	col: string
}

export class MongoAdapter implements Adapter<MongoTableConfig> {
	readonly client: MongoClient

	constructor(config: MongoAdapterConfig) {
		this.client = new MongoClient(config.uri, { ignoreUndefined: true })
	}

	async connect(): Promise<void> {
		await this.client.connect()
	}

	async disconnect(): Promise<void> {
		await this.client.close()
	}

	private getCollection(table: MongoTableConfig): Collection {
		return this.client.db(table.db).collection(table.col)
	}

	async findMany(schema: AnySchema, table: MongoTableConfig, queryAst: QueryAST): Promise<Record<string, unknown>[]> {
		const collection = this.getCollection(table)
		const { filter, sort, limit, skip, projection } = compileMongoQuery(queryAst, schema.primaryKey)

		let cursor = collection.find(filter, {
			session: sessionStore.getStore(),
			projection,
		})
		if (sort) cursor = cursor.sort(sort)
		if (limit) cursor = cursor.limit(limit)
		if (skip) cursor = cursor.skip(skip)

		const docs = await cursor.toArray()
		return docs.map((d) => d as Record<string, unknown>)
	}

	async findOne(schema: AnySchema, table: MongoTableConfig, queryAst: QueryAST): Promise<Record<string, unknown> | null> {
		const limitedAst = { ...queryAst, limit: 1 }
		const results = await this.findMany(schema, table, limitedAst)
		return results[0] ?? null
	}

	async insertOne(
		schema: AnySchema,
		table: MongoTableConfig,
		data: Record<string, unknown>,
		options?: InsertOptions,
	): Promise<Record<string, unknown>> {
		const results = await this.insertMany(schema, table, [data], options)
		return results[0]
	}

	async insertMany(
		schema: AnySchema,
		table: MongoTableConfig,
		data: Record<string, unknown>[],
		options?: InsertOptions,
	): Promise<Record<string, unknown>[]> {
		const collection = this.getCollection(table)
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

		return docs.map((d) => d as Record<string, unknown>)
	}

	async updateMany(
		schema: AnySchema,
		table: MongoTableConfig,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown>[]> {
		const collection = this.getCollection(table)
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
		const updatedDocs = await cursor.toArray()
		return updatedDocs.map((d) => d as Record<string, unknown>)
	}

	async updateOne(
		schema: AnySchema,
		table: MongoTableConfig,
		queryAst: QueryAST,
		data: Record<string, unknown>,
		options?: UpdateOptions,
	): Promise<Record<string, unknown> | null> {
		const collection = this.getCollection(table)
		const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
		const now = options?.getTime?.() ?? new Date()

		const update = compileMongoUpdate(data, queryAst.raws, now)
		const doc = await collection.findOneAndUpdate(filter, update, {
			returnDocument: 'after',
			session: sessionStore.getStore(),
		})

		return doc ? (doc as Record<string, unknown>) : null
	}

	async upsertOne(
		schema: AnySchema,
		table: MongoTableConfig,
		queryAst: QueryAST,
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	): Promise<Record<string, unknown>> {
		const collection = this.getCollection(table)
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
	}

	async deleteOne(schema: AnySchema, table: MongoTableConfig, queryAst: QueryAST): Promise<Record<string, unknown> | null> {
		const collection = this.getCollection(table)
		const { filter } = compileMongoQuery(queryAst, schema.primaryKey)

		const doc = await collection.findOneAndDelete(filter, { session: sessionStore.getStore() })
		return doc ? (doc as Record<string, unknown>) : null
	}

	async deleteMany(schema: AnySchema, table: MongoTableConfig, queryAst: QueryAST): Promise<Record<string, unknown>[]> {
		const docs = await this.findMany(schema, table, queryAst)
		const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
		await this.getCollection(table).deleteMany(filter, { session: sessionStore.getStore() })
		return docs
	}

	async count(schema: AnySchema, table: MongoTableConfig, queryAst: QueryAST): Promise<number> {
		const { filter } = compileMongoQuery(queryAst, schema.primaryKey)
		return this.getCollection(table).countDocuments(filter)
	}

	async session<T>(callback: () => Promise<T>): Promise<T> {
		if (sessionStore.getStore()) return callback()
		const session = await this.client.startSession()
		return session.withTransaction(async () => sessionStore.run(session, callback))
	}

	async query(
		schema: AnySchema,
		table: MongoTableConfig,
		queryAst: QueryAST,
		pagination: { page: number; limit: number; all: boolean },
	): Promise<PaginatedResult<Record<string, unknown>>> {
		const collection = this.getCollection(table)
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
	}
}
