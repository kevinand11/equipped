import mongoose from 'mongoose'
import { exit } from '../../exit'
import { Instance } from '../../instance'
import { BaseEntity } from '../../structure'
import { retry } from '../../utils/retry'
import { Validation } from '../../validations'
import { TopicPrefix } from '../debezium'
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

	async start (): Promise<void> {
		if (this.#started) return
		this.#started = true

		const model = this.#model
		const dbName = model.db.name
		const colName = model.collection.name
		const dbColName = `${dbName}.${colName}`
		const topic = `${TopicPrefix}.${dbColName}`

		retry(async () => {
			const { hosts, replicaSet, credentials } = model.collection.conn.getClient().options

			const started = await this._setup(topic, {
				'connector.class': 'io.debezium.connector.mongodb.MongoDbConnector',
				'capture.mode': 'change_streams_update_full_with_pre_image',
				'mongodb.hosts': `${replicaSet}/` + hosts.map((h) => `${h.host}:${h.port}`).join(','),
				...(credentials ? {
					'mongodb.user': credentials.username,
					'mongodb.pass': credentials.password,
					'mongodb.auth-source': credentials.source
				} : {}),
				'collection.include.list': dbColName
			})

			const TestId = new mongoose.Types.ObjectId('__equipped__')

			if (!started) {
				await model.findByIdAndUpdate(TestId, { $set: { colName } }, { upsert: true })
				await model.findByIdAndDelete(TestId)
				throw new Error(`Wait a few minutes for db changes for ${colName} to initialize...`)
			}

			const hydrate = (data: any) => model.hydrate({
				...data, _id: new mongoose.Types.ObjectId(data._id['$oid'])
			}).toObject({ getters: true, virtuals: true })

			if (started) await Instance.get().eventBus
				.createSubscriber(topic as never, async (data: DbDocumentChange) => {
					const op = data.op

					let before = JSON.parse(data.before ?? 'null')
					let after = JSON.parse(data.after ?? 'null')

					if (before?.__id === TestId || after?.__id === TestId) return

					if (before) before = hydrate(before)
					if (after) after = hydrate(after)

					if (op === 'c' && this.callbacks.created && after) await this.callbacks.created({
						before: null,
						after: this.mapper(after)!
					})
					else if (op === 'u' && this.callbacks.updated && before) await this.callbacks.updated({
						before: this.mapper(before)!,
						after: this.mapper(after)!,
						changes: Validation.Differ.from(
							Validation.Differ.diff(before, after)
						)
					})
					else if (op === 'd' && this.callbacks.deleted && before) await this.callbacks.deleted({
						before: this.mapper(before)!,
						after: null
					})
				})
				.subscribe()
		}, 10, 60_000)
			.catch((err) => exit(err.message))
	}
}


type DbDocumentChange = {
	before: string | null
	after: string | null
	op: 'c' | 'u' | 'd'
}