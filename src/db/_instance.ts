import axios from 'axios'

import { Instance } from '../instance'
import type { DeepPartial } from '../types'
import * as core from './core'

export const TopicPrefix = 'db-changes'

export type TableOptions = { skipAudit?: boolean }

export type Config<Model extends core.Model<any>, Entity extends core.Entity> = {
	db: string
	col: string
	mapper: (model: Model) => Entity
	change?: DbChangeCallbacks<Model, Entity>
	options?: { skipAudit?: boolean }
}

export abstract class Db<IdKey extends core.IdType> {
	#dbChanges = [] as DbChange<any, any>[]

	protected getScopedDb(db: string) {
		return Instance.get().getScopedName(db).replaceAll('.', '-')
	}

	protected _addToDbChanges(dbChange: DbChange<any, any>) {
		this.#dbChanges.push(dbChange)
		return this
	}

	async startAllDbChanges() {
		await Promise.all(this.#dbChanges.map((change) => change.start()))
	}

	abstract start(): Promise<void>
	abstract close(): Promise<void>

	abstract use<Model extends core.Model<IdKey>, Entity extends core.Entity>(
		config: Config<Model, Entity>,
	): core.Table<IdKey, Model, Entity>
}

export abstract class DbChange<Model extends core.Model<any>, Entity extends core.Entity> {
	#callbacks: DbChangeCallbacks<Model, Entity> = {}
	#mapper: (model: Model) => Entity

	constructor(callbacks: DbChangeCallbacks<Model, Entity>, mapper: (model: Model) => Entity) {
		this.#callbacks = callbacks
		this.#mapper = mapper
	}

	abstract start(): Promise<void>

	get callbacks() {
		return Object.freeze(this.#callbacks)
	}

	get mapper() {
		return this.#mapper
	}

	protected async configureConnector(key: string, data: Record<string, string>) {
		const baseURL = Instance.get().settings.debeziumUrl
		return await axios
			.put(
				`/connectors/${key}/config`,
				{
					'topic.prefix': TopicPrefix,
					'topic.creation.enable': 'false',
					'topic.creation.default.replication.factor': `-1`,
					'topic.creation.default.partitions': '-1',
					'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
					'key.converter.schemas.enable': 'false',
					'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
					'value.converter.schemas.enable': 'false',
					...data,
				},
				{ baseURL },
			)
			.then(async () => {
				const topics = await axios.get(`/connectors/${key}/topics`, { baseURL })
				return topics.data[key]?.topics?.includes?.(key) ?? false
			})
			.catch((err) => {
				const message = err.response?.data?.message ?? err.message
				throw new Error(`Failed to configure watcher for ${key}: ${message}`)
			})
	}
}

export type DbChangeCallbacks<Model extends core.Model<any>, Entity extends core.Entity> = {
	created?: (data: { before: null; after: Entity }) => Promise<void>
	updated?: (data: { before: Entity; after: Entity; changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity; after: null }) => Promise<void>
}
