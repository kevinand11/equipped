import { Filter, MongoClient, ObjectId } from 'mongodb'

import { EquippedError } from '../../errors'
import { exit } from '../../exit'
import { Instance } from '../../instance'
import { retry } from '../../utils/retry'
import { Validation } from '../../validations'
import { DbChange, DbChangeCallbacks, TopicPrefix } from '../_instance'
import * as core from '../core'

export class MongoDbChange<Model extends core.Model<{ _id: string }>, Entity extends core.Entity> extends DbChange<Model, Entity> {
	#started = false

	constructor(
		private client: MongoClient,
		private dbName: string,
		private colName: string,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model) => Entity,
	) {
		super(callbacks, mapper)
	}

	async start(): Promise<void> {
		if (this.#started) return
		this.#started = true

		const collection = this.client.db(this.dbName).collection<Model>(this.colName)
		const dbName = this.dbName
		const colName = this.colName
		const dbColName = `${dbName}.${colName}`
		const topic = `${TopicPrefix}.${dbColName}`

		const hexId = '5f5f65717569707065645f5f' // __equipped__
		const TestId = makeId(hexId)
		const condition = { _id: TestId } as Filter<Model>

		const hydrate = (data: any) =>
			data._id
				? {
						...data,
						_id: makeId(data._id['$oid'] ?? data._id),
					}
				: undefined

		Instance.get().eventBus.createSubscriber(
			topic as never,
			async (data: DbDocumentChange) => {
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
			},
			{ skipScope: true },
		)

		await retry(
			async () => {
				const started = await this.configureConnector(topic, {
					'connector.class': 'io.debezium.connector.mongodb.MongoDbConnector',
					'capture.mode': 'change_streams_update_full_with_pre_image',
					'mongodb.connection.string': Instance.get().settings.mongoDbURI,
					'collection.include.list': dbColName,
					'snapshot.mode': 'when_needed',
				})

				if (started) return { done: true, value: true }
				await collection.findOneAndUpdate(condition, { $set: { colName } as any }, { upsert: true })
				await collection.findOneAndDelete(condition)
				await Instance.get().logger.warn(`Waiting for db changes for ${dbColName} to start...`)
				return { done: false }
			},
			6,
			10_000,
		).catch((err) => exit(new EquippedError(`Failed to start db changes`, { dbColName }, err)))
	}
}

type DbDocumentChange = {
	before: string | null
	after: string | null
	op: 'c' | 'u' | 'd'
}

const makeId = (id: string) => {
	try {
		return new ObjectId(id)
	} catch {
		return id
	}
}
