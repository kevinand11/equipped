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
		const getStreamTokens = () => this.#model.collection.conn.db.collection('stream-tokens')

		const res = await getStreamTokens().findOne({ _id: dbName })
		const resumeToken = skipResume ? undefined : res?.resumeToken

		const changeStream = this.#model
			.watch<mongoose.Document<Model>>([], { fullDocument: 'whenAvailable', fullDocumentBeforeChange: 'whenAvailable', startAfter: resumeToken })
			.on('change', async (data) => {
				// @ts-ignore
				const streamId = data._id._data
				const shouldRun = await this._shouldRun(streamId)
				if (!shouldRun) return

				addWaitBeforeExit((async () => {
					await getStreamTokens().findOneAndUpdate({ _id: dbName }, { $set: { resumeToken: data._id } }, { upsert: true })

					const hydrate = (value: any) => value ? this.#model.hydrate(value).toObject({ getters: true, virtuals: true }) : null

					if (data.operationType === 'insert' && this.callbacks.created) {
						const after = data.fullDocument
						if (after) await this.callbacks.created({
							before: null,
							after: this.mapper(hydrate(after))!
						})
					}

					if (data.operationType === 'delete' && this.callbacks.deleted) {
						const before = data.fullDocumentBeforeChange
						if (before) this.callbacks.deleted?.({
							before: this.mapper(hydrate(before))!,
							after: null
						})
					}

					if (data.operationType === 'update' && this.callbacks.updated) {
						const before = data.fullDocumentBeforeChange
						const after = data.fullDocument
						const changes = Validation.Differ.from(Validation.Differ.diff(before, after))
						if (before && after) this.callbacks.updated({
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