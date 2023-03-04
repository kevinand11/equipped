import mongoose from 'mongoose'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { BaseEntity } from '../../structure'
import { Validation } from '../../validations'
import { DbChange, DbChangeCallbacks } from '../_instance'

export class MongoDbChange<Model, Entity extends BaseEntity> extends DbChange<Model, Entity> {
	#started = false
	#model: mongoose.Model<Model>

	constructor (
		model: mongoose.Model<Model>,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	) {
		super(callbacks, mapper)
		this.#model = model
	}

	async start (skipResume = false): Promise<void> {
		if (this.#started) return
		this.#started = true

		const dbName = this.#model.collection.name
		const cloneName = dbName + '_streams_clone'
		const getClone = () => this.#model.collection.conn.db.collection(cloneName)
		const getStreamTokens = () => this.#model.collection.conn.db.collection('stream-tokens')

		const res = await getStreamTokens().findOne({ _id: dbName })
		const resumeToken = skipResume ? undefined : res?.resumeToken

		const changeStream = this.#model
			.watch([], { fullDocument: 'updateLookup', startAfter: resumeToken })
			.on('change', async (data) => {
				// @ts-ignore
				const streamId = data._id._data
				const shouldRun = await this._shouldRun(streamId)
				if (!shouldRun) return

				addWaitBeforeExit((async () => {
					await getStreamTokens().findOneAndUpdate({ _id: dbName }, { $set: { resumeToken: data._id } }, { upsert: true })

					const hydrate = (value: any) => value ? this.#model.hydrate(value).toObject({ getters: true, virtuals: true }) : null

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
							after: this.mapper(hydrate(after))!
						})
					}

					if (data.operationType === 'delete') {
						// @ts-ignore
						const _id = data.documentKey!._id
						const { value: before } = await getClone().findOneAndDelete({ _id })
						if (before) this.callbacks.deleted?.({
							before: this.mapper(hydrate(before))!,
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
							before: this.mapper(hydrate(before))!,
							after: this.mapper(hydrate(after))!,
							changes
						})
					}
				})())
			})
			.on('error', async (err) => {
				await Instance.get().logger.error(`Change Stream errored out: ${dbName}: ${err.message}`)
				await changeStream.close()
				return this.start(true)
			})
		addWaitBeforeExit(async () => {
			await changeStream.close()
			this.#started = false
		})
	}
}