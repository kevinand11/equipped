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

	get Schema () {
		return mongoose.Schema
	}

	get Id () {
		return new mongoose.Types.ObjectId()
	}

	get #connections () {
		// @ts-ignore
		return mongoose.connection.otherDbs as mongoose.Connection[] ?? []
	}

	use (dbName = 'default') {
		const conn = dbName === 'default' ? mongoose.connection : mongoose.connection.useDb(dbName, { useCache: true })
		conn.plugin(defaults).plugin(virtuals).plugin(getters)
		return conn
	}

	change<Model, Entity extends BaseEntity<any>> (
		model: mongoose.Model<Model>,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	) {
		const change = new MongoDbChange<Model, Entity>(model, callbacks, mapper)
		this._addToDbChanges(change)
		return change
	}

	async query<Model> (
		model: mongoose.Model<Model>,
		params: QueryParams
	): Promise<QueryResults<Model>> {
		return await parseMongodbQueryParams(model, params)
	}

	async start () {
		if (this.#started) return
		this.#started = true

		mongoose.set('strictQuery', true)
		await mongoose.connect(Instance.get().settings.mongoDbURI)

		await Promise.all(
			[mongoose.connection, ...this.#connections].map((conn) => {
				return Object.values(conn.models)
					.map(async (model) => {
						await conn.db.createCollection(model.collection.name, {
							changeStreamPreAndPostImages: { enabled: true }
						})
					})
			}).flat()
		)
	}

	async close () {
		await Promise.all(this.#connections.map(async (conn) => conn.close()))
		await mongoose.disconnect()
	}
}