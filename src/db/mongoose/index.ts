import mongoose from 'mongoose'
import defaults from 'mongoose-lean-defaults'
import getters from 'mongoose-lean-getters'
import virtuals from 'mongoose-lean-virtuals'

import { Instance } from '../../instance'
import type { BaseEntity } from '../../structure'
import type { DbChangeCallbacks } from '../_instance'
import { Db } from '../_instance'
import type { QueryParams, QueryResults } from '../query'
import { MongoDbChange } from './changes'
import { parseMongodbQueryParams } from './query'

export class MongoDb extends Db {
	#started = false

	get Schema() {
		return mongoose.Schema
	}

	get Id() {
		return new mongoose.Types.ObjectId()
	}

	get #connections() {
		// @ts-ignore
		return (mongoose.connection.otherDbs as mongoose.Connection[]) ?? []
	}

	use(dbName: string) {
		const conn = mongoose.connection.useDb(Instance.get().getScopedName(dbName).replaceAll('.', '-'), { useCache: true })
		conn.plugin(defaults).plugin(virtuals).plugin(getters)
		return conn
	}

	change<Model, Entity extends BaseEntity<any, any>>(
		model: mongoose.Model<Model>,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null,
	) {
		const change = new MongoDbChange<Model, Entity>(model, callbacks, mapper)
		this._addToDbChanges(change)
		return change
	}

	async query<Model>(model: mongoose.Model<Model>, params: QueryParams): Promise<QueryResults<Model>> {
		return await parseMongodbQueryParams(model, params)
	}

	async start() {
		if (this.#started) return
		this.#started = true

		mongoose.set('strictQuery', true)
		await mongoose.connect(Instance.get().settings.mongoDbURI)

		await Promise.all(
			[mongoose.connection, ...this.#connections]
				.map((conn) =>
					Object.values(conn.models).map(async (model) => {
						if (!conn.db) return
						const name = model.collection.name
						const options = {
							changeStreamPreAndPostImages: { enabled: true },
						}
						const existing = await conn.db.listCollections<mongoose.mongo.CollectionInfo>({ name }).next()
						if (existing) {
							if (existing.options?.changeStreamPreAndPostImages?.enabled !== options.changeStreamPreAndPostImages.enabled) await conn.db.command({ collMod: name, ...options })
						} else await conn.db.createCollection(name, options)
					}),
				)
				.flat(),
		)
	}

	async close() {
		await Promise.all(this.#connections.map(async (conn) => conn.close()))
		await mongoose.disconnect()
	}
}
