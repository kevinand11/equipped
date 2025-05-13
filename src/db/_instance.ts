import axios from 'axios'

import { Instance } from '../instance'
import type { BaseEntity } from '../structure'
import type { DeepPartial } from '../types'
import type { QueryParams, QueryResults } from './query'

export const TopicPrefix = 'db-changes'

export abstract class Db {
	#dbChanges = [] as DbChange<any, any>[]

	abstract change<Model, Entity extends BaseEntity<any, any>>(
		collection: any,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null,
	): DbChange<Model, Entity>

	abstract query<Model>(collection: any, params: QueryParams): Promise<QueryResults<Model>>

	protected _addToDbChanges(dbChange: DbChange<any, any>) {
		this.#dbChanges.push(dbChange)
		return this
	}

	async startAllDbChanges() {
		await Promise.all(this.#dbChanges.map((change) => change.start()))
	}

	abstract start(): Promise<void>
	abstract close(): Promise<void>
}

export abstract class DbChange<Model, Entity extends BaseEntity<any, any>> {
	#callbacks: DbChangeCallbacks<Model, Entity> = {}
	#mapper: (model: Model | null) => Entity | null

	constructor(callbacks: DbChangeCallbacks<Model, Entity>, mapper: (model: Model | null) => Entity | null) {
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

	protected async _setup(key: string, data: Record<string, string>) {
		const baseURL = Instance.get().settings.debeziumUrl
		return await axios
			.put(`/connectors/${key}/config`, {
				'topic.prefix': TopicPrefix,
				'topic.creation.enable': 'false',
				'topic.creation.default.replication.factor': `-1`,
				'topic.creation.default.partitions': '-1',
				'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
				'key.converter.schemas.enable': 'false',
				'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
				'value.converter.schemas.enable': 'false',
				...data,
			}, { baseURL })
			.then(async () => {
				const topics = await axios.get(`/connectors/${key}/topics`, { baseURL })
				return topics.data[key]?.topics?.at?.(0) === key
			})
			.catch((err) => {
				const message = err.response?.data?.message ?? err.message
				throw new Error(`Failed to setup debezium for ${key}: ${message}`)
			})
	}
}

export type DbChangeCallbacks<Model, Entity> = {
	created?: (data: { before: null; after: Entity }) => Promise<void>
	updated?: (data: { before: Entity; after: Entity; changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity; after: null }) => Promise<void>
}
