import axios from 'axios'

import { Instance } from '../instance'
import type { BaseEntity } from '../structure'
import type { DeepPartial } from '../types'
import type { DebeziumSetup } from './debezium'
import { DefaultDebeziumSetup } from './debezium'
import type { QueryParams, QueryResults } from './query'

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

	protected async _setup(key: string, data: DebeziumSetup) {
		data = { ...DefaultDebeziumSetup, ...data }
		return await axios
			.put(`/connectors/${key}/config`, data, { baseURL: Instance.get().settings.debeziumUrl })
			.then(async () => {
				const res = await axios.get(`/connectors/${key}/status`, { baseURL: Instance.get().settings.debeziumUrl })
				return res.data.tasks.every((task) => task.state === 'RUNNING')
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
