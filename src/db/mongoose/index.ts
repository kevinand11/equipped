import mongoose from 'mongoose'
import defaults from 'mongoose-lean-defaults'
import getters from 'mongoose-lean-getters'
import virtuals from 'mongoose-lean-virtuals'
import { Instance } from '../../instance'
import { BaseEntity } from '../../structure'
import { QueryParams, QueryResults } from '../query'
import { Db, DbChangeCallbacks } from '../_instance'
import { MongoDbChange } from './changes'
import { parseMongodbQueryParams } from './query'

export class MongoDb extends Db {
	#started = false
	#conns = new Map<string, mongoose.Connection>()

	get Schema () {
		return mongoose.Schema
	}

	use (dbName = 'default') {
		let conn = this.#conns.get(dbName)
		if (conn) return conn
		conn = dbName === 'default' ? mongoose.connection : mongoose.connection.useDb(dbName, { useCache: true })
		conn.set('strictQuery', true)
		conn.plugin(defaults).plugin(virtuals).plugin(getters)
		conn.on('close', () => this.#conns.delete(dbName))
		this.#conns.set(dbName, conn)
		return conn
	}

	generateDbChange<Model, Entity extends BaseEntity> (
		collection: string,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	) {
		const change = new MongoDbChange<Model, Entity>(collection, callbacks, mapper)
		this._addToDbChanges(change)
		return change
	}

	async query<Model> (
		modelName: string,
		params: QueryParams
	): Promise<QueryResults<Model>> {
		return await parseMongodbQueryParams(modelName, params)
	}

	async start () {
		if (this.#started) return
		this.#started = true

		await mongoose.connect(Instance.get().settings.mongoDbURI)

		await Promise.all(
			[...this.#conns.values()].map(async (conn) => {
				await Promise.all(
					Object.values(mongoose.models)
						.map(async (model) => {
							// Enable changesstream before images for all collections
							await conn.db.command({ collMod: model.collection.name, changeStreamPreAndPostImages: { enabled: true } })
						})
				)
			})
		)
	}

	async close () {
		await Promise.all(
			[...this.#conns.values()].map(async (conn) => conn.close())
		)
		await mongoose.disconnect()
	}
}