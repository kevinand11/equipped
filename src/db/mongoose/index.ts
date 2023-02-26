import mongoose from 'mongoose'
import { addWaitBeforeExit, exit } from '../../exit'
import { Instance } from '../../instance'
import { BaseEntity } from '../../structure'
import { Validation } from '../../validations'
import { QueryParams, QueryResults } from '../query'
import { Db, DbChange, DbChangeCallbacks } from '../_instance'
import { parseMongodbQueryParams } from './query'

export class MongoDb extends Db {
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
		return parseMongodbQueryParams(modelName, params)
	}

	async start () {
		mongoose.set('strictQuery', true)
		await mongoose.connect(Instance.get().settings.mongoDbURI)
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

	async start (skipResume = false): Promise<void> {
		if (this.#started) return
		this.#started = true

		const model = mongoose.models[this.modelName]
		if (!model) return exit(`Model ${this.modelName} not found`)

		const dbName = model.collection.collectionName
		const cloneName = dbName + '_streams_clone'
		const getClone = () => model.collection.conn.db.collection(cloneName)
		const getStreamTokens = () => model.collection.conn.db.collection('stream-tokens')

		const res = await getStreamTokens().findOne({ _id: dbName })
		const resumeToken = skipResume ? undefined : res?.resumeToken

		const changeStream = model
			.watch([], { fullDocument: 'updateLookup', startAfter: resumeToken })
			.on('change', async (data) => {
				// @ts-ignore
				const streamId = data._id._data
				const shouldRun = await this._shouldRun(streamId)
				if (!shouldRun) return

				addWaitBeforeExit((async () => {
					await getStreamTokens().findOneAndUpdate({ _id: dbName }, { $set: { resumeToken: data._id } }, { upsert: true })

					if (data.operationType === 'insert') {
						// @ts-ignore
						const _id = data.documentKey!._id
						const after = data.fullDocument as Model
						const { value } = await getClone().findOneAndUpdate({ _id }, { $set: { ...after, _id } }, {
							upsert: true,
							returnDocument: 'after'
						})
						if (value) this.callbacks.created?.({
							before: null,
							after: this.mapper(new model(after))!
						})
					}

					if (data.operationType === 'delete') {
						// @ts-ignore
						const _id = data.documentKey!._id
						const { value: before } = await getClone().findOneAndDelete({ _id })
						if (before) this.callbacks.deleted?.({
							before: this.mapper(new model(before))!,
							after: null
						})
					}

					if (data.operationType === 'update') {
						// @ts-ignore
						const _id = data.documentKey!._id
						const after = data.fullDocument as Model
						const { value: before } = await getClone().findOneAndUpdate({ _id }, { $set: after as any }, { returnDocument: 'before' })
						// @ts-ignore
						const {
							updatedFields = {},
							removedFields = [],
							truncatedArrays = []
						} = data.updateDescription ?? {}
						const changed = removedFields
							.concat(truncatedArrays.map((a) => a.field))
							.concat(Object.keys(updatedFields))
						const changes = Validation.Differ.from(changed)
						if (before) this.callbacks.updated?.({
							before: this.mapper(new model(before))!,
							after: this.mapper(new model(after))!,
							changes
						})
					}
				})())
			})
			.on('error', async (err) => {
				await Instance.get().logger.error(`Change Stream errored out: ${dbName}: ${err.message}`)
				changeStream.close()
				return this.start(true)
			})
		addWaitBeforeExit(async () => {
			changeStream.close()
			this.#started = false
		})
	}
}