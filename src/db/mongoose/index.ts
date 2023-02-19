import mongoose from 'mongoose'
import { BaseEntity } from '../../structure'
import { Db, Callbacks, DbChange } from '../_instance'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { Validation } from '../../validations'

export class MongoDb extends Db {
	generateDbChange<Model extends { _id: string }, Entity extends BaseEntity> (
		collection: mongoose.Model<Model | any>,
		mapper: (model: Model | null) => Entity | null
	) {
		const change = new MongoDbChange<Model, Entity>(collection, mapper)
		this._addToDbChanges(change)
		return change
	}

	async start (url: string) {
		await mongoose.connect(url)
	}

	async close () {
		await mongoose.disconnect()
	}
}


class MongoDbChange<Model extends { _id: string }, Entity extends BaseEntity> extends DbChange<Model, Entity> {
	#started = false
	#col: mongoose.Model<Model | any>
	#mapper: (model: Model | null) => Entity | null
	_cbs: Callbacks<Model, Entity>

	constructor (
		collection: mongoose.Model<Model | any>,
		mapper: (model: Model | null) => Entity | null
	) {
		super()
		this.#col = collection
		this.#mapper = mapper
		this._cbs = {}
	}

	async start (skipResume = false) {
		if (this.#started) return
		this.#started = true
		const dbName = this.#col.collection.collectionName as any
		const cloneName = dbName + '_streams_clone'
		const getClone = () => this.#col.collection.conn.db.collection(cloneName)
		const getStreamTokens = () => this.#col.collection.conn.db.collection('stream-tokens')

		const res = await getStreamTokens().findOne({ _id: dbName })
		const resumeToken = skipResume ? undefined : res?.resumeToken

		const changeStream = this.#col
			.watch([], { fullDocument: 'updateLookup', startAfter: resumeToken })
			.on('change', async (data) => {
				// @ts-ignore
				const streamId = data._id._data
				const cacheName = `streams-${streamId}`
				const cached = await Instance.get().cache.setInTransaction(cacheName, streamId, 15)
				if (cached[0]) return
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
						if (value) this._cbs.created?.({
							before: null,
							after: this.#mapper(new this.#col(after))!
						})
					}

					if (data.operationType === 'delete') {
						// @ts-ignore
						const _id = data.documentKey!._id
						const { value: before } = await getClone().findOneAndDelete({ _id })
						if (before) this._cbs.deleted?.({
							before: this.#mapper(new this.#col(before))!,
							after: null
						})
					}

					if (data.operationType === 'update') {
						// @ts-ignore
						const _id = data.documentKey!._id
						const after = data.fullDocument as Model
						const { value: before } = await getClone().findOneAndUpdate({ _id }, { $set: after }, { returnDocument: 'before' })
						// @ts-ignore
						const {
							updatedFields = {},
							removedFields = [],
							truncatedArrays = []
						} = data.updateDescription ?? {}
						const changed = removedFields
							.map((f) => f.toString())
							.concat(truncatedArrays.map((a) => a.field))
							.concat(Object.keys(updatedFields))
						const changes = Validation.Differ.from(changed)
						if (before) this._cbs.updated?.({
							before: this.#mapper(new this.#col(before))!,
							after: this.#mapper(new this.#col(after))!,
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

		await Instance.get().logger.info(`${dbName} changestream started`)
	}
}