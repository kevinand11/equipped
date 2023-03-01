import mongoose from 'mongoose'
import defaults from 'mongoose-lean-defaults'
import getters from 'mongoose-lean-getters'
import virtuals from 'mongoose-lean-virtuals'
import { exit } from '../../exit'
import { Instance } from '../../instance'
import { BaseEntity } from '../../structure'
import { retry } from '../../utils/retry'
import { Validation } from '../../validations'
import { TopicPrefix } from '../debezium'
import { QueryParams, QueryResults } from '../query'
import { Db, DbChange, DbChangeCallbacks } from '../_instance'
import { parseMongodbQueryParams } from './query'

mongoose.plugin(defaults)
	.plugin(virtuals)
	.plugin(getters)

export { mongoose }

export class MongoDb extends Db {
	#started = false

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
		const model = mongoose.models[modelName]
		if (!model) return exit(`Model ${modelName} not found`)
		return await parseMongodbQueryParams(model, params)
	}

	async start () {
		if (this.#started) return
		this.#started = true

		mongoose.set('strictQuery', true)
		await mongoose.connect(Instance.get().settings.mongoDbURI)
		const db = mongoose.connection.db
		await Promise.all(
			Object.values(mongoose.models)
				.map(async (model) => {
					// Enable changesstream before images for all collections
					await db.command({ collMod: model.collection.collectionName, changeStreamPreAndPostImages: { enabled: true } })
				})
		)
	}

	async close () {
		await mongoose.disconnect()
	}
}


class MongoDbChange<Model, Entity extends BaseEntity> extends DbChange<Model, Entity> {
	#started = false

	constructor (
		modelName: string,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	) {
		super(modelName, callbacks, mapper)
	}

	async start (): Promise<void> {
		if (this.#started) return
		this.#started = true

		const dbName = mongoose.connection.name
		const model = mongoose.models[this.modelName]
		if (!model) return exit(`Model ${this.modelName} not found`)
		const colName = model.collection.collectionName
		const dbColName = `${dbName}.${colName}`
		const topic = `${TopicPrefix}.${dbColName}`

		retry(async () => {
			const started = await this._setup(topic, {
				'connector.class': 'io.debezium.connector.mongodb.MongoDbConnector',
				'capture.mode': 'change_streams_update_full_with_pre_image',
				'mongodb.connection.string': Instance.get().settings.mongoDbURI,
				'collection.include.list': dbColName
			})

			const TestId = '__equipped__testing__'

			if (!started) {
				const db = mongoose.connection.db
				await db.collection(colName).findOneAndUpdate({ _id: TestId }, { $set: { colName } }, { upsert: true })
				await db.collection(colName).deleteOne({ _id: TestId })
				throw new Error(`Wait a few minutes for db changes for ${colName} to initialize...`)
			}

			if (started) await Instance.get().eventBus
				.createSubscriber(topic as never, async (data: DbDocumentChange) => {
					const op = data.op

					const before = JSON.parse(data.before ?? 'null')
					const after = JSON.parse(data.after ?? 'null')

					if (before?.__id === TestId || after?.__id === TestId) return

					if (op === 'c' && this.callbacks.created) {
						if (after) await this.callbacks.created({
							before: null,
							after: this.mapper(new model(after))!
						})
					} else if (op === 'u' && this.callbacks.updated) {
						if (before) await this.callbacks.updated({
							before: this.mapper(new model(before))!,
							after: this.mapper(new model(after))!,
							changes: Validation.Differ.from(
								Validation.Differ.diff(before, after)
							)
						})
					} else if (op === 'd' && this.callbacks.deleted) {
						if (before) await this.callbacks.deleted({
							before: this.mapper(new model(before))!,
							after: null
						})
					}
				})
				.subscribe()
		}, 5, 120_000)
			.catch((err) => exit(err.message))
	}
}

type DbDocumentChange = {
	before: string | null
	after: string | null
	op: 'c' | 'u' | 'd'
}