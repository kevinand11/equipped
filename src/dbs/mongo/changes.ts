import { Collection, Filter, ObjectId } from 'mongodb'
import { differ } from 'valleyed'

import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import { retry } from '../../utilities'
import { DbChange, TopicPrefix } from '../base/changes'
import * as core from '../base/core'
import { DbChangeConfig } from '../base/types'
import { MongoDbConfig } from '../pipes'

export class MongoDbChange<Model extends core.Model<{ _id: string }>, Entity extends core.Entity> extends DbChange<Model, Entity> {
	#started = false

	constructor(
		config: MongoDbConfig,
		change: DbChangeConfig,
		collection: Collection<Model>,
		callbacks: core.DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model) => Entity,
	) {
		super(change, callbacks, mapper)

		const hydrate = (data: any) =>
			data._id
				? {
						...data,
						_id: makeId(data._id['$oid'] ?? data._id),
					}
				: undefined

		const dbName = collection.dbName
		const colName = collection.collectionName
		const dbColName = `${dbName}.${colName}`
		const topic = `${TopicPrefix}.${dbColName}`

		const hexId = '5f5f65717569707065645f5f' // __equipped__
		const TestId = makeId(hexId)
		const condition = { _id: TestId } as Filter<Model>

		change.eventBus.createStream(topic as never, { skipScope: true }).subscribe(async (data: DbDocumentChange) => {
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
		})

		Instance.on(
			'start',
			async () => {
				if (this.#started) return
				this.#started = true

				await retry(
					async () => {
						const started = await this.configureConnector(topic, {
							'connector.class': 'io.debezium.connector.mongodb.MongoDbConnector',
							'capture.mode': 'change_streams_update_full_with_pre_image',
							'mongodb.connection.string': config.uri,
							'collection.include.list': dbColName,
							'snapshot.mode': 'when_needed',
						})

						if (started) return { done: true, value: true }
						await collection.findOneAndUpdate(condition, { $set: { colName } as any }, { upsert: true })
						await collection.findOneAndDelete(condition)
						Instance.get().log.warn(`Waiting for db changes for ${dbColName} to start...`)
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
