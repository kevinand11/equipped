import { Filter, MongoClient, ObjectId } from 'mongodb'

import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import { MongoDbConfig } from '../../schemas'
import { retry } from '../../utils/retry'
import { differ } from '../../validations'
import { DbChange, DbChangeCallbacks, TopicPrefix } from '../base/_instance'
import * as core from '../base/core'

export class MongoDbChange<Model extends core.Model<{ _id: string }>, Entity extends core.Entity> extends DbChange<Model, Entity> {
	#started = false

	constructor(
		private config: MongoDbConfig,
		private client: MongoClient,
		private dbName: string,
		private colName: string,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model) => Entity,
	) {
		super(callbacks, mapper)

		Instance.addHook(
			'pre:start',
			async () => {
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

				Instance.get().dbChangesEventBus.createSubscriber(
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
								changes: differ.from(differ.diff(before, after)),
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
							'mongodb.connection.string': this.config.uri,
							'collection.include.list': dbColName,
							'snapshot.mode': 'when_needed',
						})

						if (started) return { done: true, value: true }
						await collection.findOneAndUpdate(condition, { $set: { colName } as any }, { upsert: true })
						await collection.findOneAndDelete(condition)
						Instance.get().logger.warn(`Waiting for db changes for ${dbColName} to start...`)
						return { done: false }
					},
					6,
					10_000,
				).catch((err) => Instance.crash(new EquippedError(`Failed to start db changes`, { dbColName }, err)))
			},
			10,
		)
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
