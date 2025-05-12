import mongoose from 'mongoose'

import { exit } from '../../exit'
import { Instance } from '../../instance'
import type { BaseEntity } from '../../structure'
import { retry } from '../../utils/retry'
import { Validation } from '../../validations'
import type { DbChangeCallbacks } from '../_instance'
import { DbChange } from '../_instance'
import { TopicPrefix } from '../debezium'

export class MongoDbChange<Model, Entity extends BaseEntity<any, any>> extends DbChange<Model, Entity> {
	#started = false
	#model: mongoose.Model<Model>

	constructor(model: mongoose.Model<Model>, callbacks: DbChangeCallbacks<Model, Entity>, mapper: (model: Model | null) => Entity | null) {
		super(callbacks, mapper)
		this.#model = model
	}

	async start(): Promise<void> {
		if (this.#started) return
		this.#started = true

		const model = this.#model
		const dbName = model.db.name
		const colName = model.collection.name
		const dbColName = `${dbName}.${colName}`
		const topic = `${TopicPrefix}.${dbColName}`

		await retry(
			async () => {
				const started = await this._setup(topic, {
					'connector.class': 'io.debezium.connector.mongodb.MongoDbConnector',
					'capture.mode': 'change_streams_update_full_with_pre_image',
					'mongodb.connection.string': Instance.get().settings.mongoDbURI,
					'collection.include.list': dbColName,
				})

				const hexId = '5f5f65717569707065645f5f' // __equipped__
				const TestId = new mongoose.Types.ObjectId(hexId)

				const hydrate = (data: any) =>
					data._id
						? model
								.hydrate({
									...data,
									_id: makeId(data._id['$oid'] ?? data._id),
								})
								.toObject({ getters: true, virtuals: true })
						: undefined

				Instance.get().eventBus.createSubscriber(topic as never, async (data: DbDocumentChange) => {
					const op = data.op

					let before = JSON.parse(data.before ?? 'null')
					let after = JSON.parse(data.after ?? 'null')

					if (before) before = hydrate(before)
					if (after) after = hydrate(after)
					if (before?.__id === TestId || after?.__id === TestId) return

					if (op === 'c' && this.callbacks.created && after)
						await this.callbacks.created({
							before: null,
							after: this.mapper(after)!,
						})
					else if (op === 'u' && this.callbacks.updated && before && after)
						await this.callbacks.updated({
							before: this.mapper(before)!,
							after: this.mapper(after)!,
							changes: Validation.Differ.from(Validation.Differ.diff(before, after)),
						})
					else if (op === 'd' && this.callbacks.deleted && before)
						await this.callbacks.deleted({
							before: this.mapper(before)!,
							after: null,
						})
				})

				if (started) return { done: true, value: true }
				await model.findByIdAndUpdate(TestId, { $set: { colName } }, { upsert: true })
				await model.findByIdAndDelete(TestId)
				await Instance.get().logger.warn(`Waiting for db changes for ${dbColName} to start...`)
				return { done: false }
			},
			5,
			60_000,
		).catch((err) => exit(`Failed to start db changes for ${dbColName}: ${err.message}`))
	}
}

type DbDocumentChange = {
	before: string | null
	after: string | null
	op: 'c' | 'u' | 'd'
}

const makeId = (id: string) => {
	try {
		return new mongoose.Types.ObjectId(id)
	} catch {
		return id
	}
}
