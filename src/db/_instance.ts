import axios from 'axios'
import { exit } from '../exit'
import { Instance } from '../instance'
import { BaseEntity } from '../structure'
import { DebeziumSetup, DefaultDebeziumSetup } from './debezium'
import { QueryParams, QueryResults } from './query'

export abstract class Db {
	#dbChanges = [] as DbChange<any, any>[]

	abstract change<Model, Entity extends BaseEntity> (
		collection: any,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	): DbChange<Model, Entity>

	abstract query<Model> (
		collection: any,
		params: QueryParams
	): Promise<QueryResults<Model>>

	protected _addToDbChanges (dbChange: DbChange<any, any>) {
		this.#dbChanges.push(dbChange)
		return this
	}

	async startAllDbChanges () {
		await Promise.all(
			this.#dbChanges.map((change) => change.start())
		)
	}

	abstract start (): Promise<void>
	abstract close (): Promise<void>
}

export abstract class DbChange<Model, Entity extends BaseEntity> {
	#callbacks: DbChangeCallbacks<Model, Entity> = {}
	#mapper: (model: Model | null) => Entity | null

	constructor (
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	) {
		this.#callbacks = callbacks
		this.#mapper = mapper
	}

	abstract start (): Promise<void>

	get callbacks () {
		return Object.freeze(this.#callbacks)
	}

	get mapper () {
		return this.#mapper
	}

	protected async _setup (key: string, data: DebeziumSetup) {
		data = { ...DefaultDebeziumSetup, ...data }
		const topics = await axios.put(`/connectors/${key}/config`, data, { baseURL: Instance.get().settings.debeziumUrl })
			.then(async () => {
				const res = await axios.get(`/connectors/${key}/topics`, { baseURL: Instance.get().settings.debeziumUrl })
				return res.data[key]?.topics ?? []
			})
			.catch((err) => {
				exit(`Failed to setup debezium for ${key}: ${err.message}`)
				return []
			})
		return topics[0] === key
	}
}

type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }
export type DbChangeCallbacks<Model, Entity> = {
	created?: (data: { before: null, after: Entity }) => Promise<void>
	updated?: (data: { before: Entity, after: Entity, changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity, after: null }) => Promise<void>
}