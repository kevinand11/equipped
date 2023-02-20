import { Instance } from '../instance'
import { BaseEntity } from '../structure'
import { QueryParams, QueryResults } from './query'

export abstract class Db {
	#dbChanges = [] as DbChange<any, any>[]

	abstract generateDbChange<Model, Entity extends BaseEntity> (
		modelName: string,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	): DbChange<Model, Entity>

	abstract query<Model> (
		modelName: string,
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

	abstract start (url: string): Promise<void>
	abstract close (): Promise<void>
}

export abstract class DbChange<Model, Entity extends BaseEntity> {
	#modelName: string
	#callbacks: DbChangeCallbacks<Model, Entity> = {}
	#mapper: (model: Model | null) => Entity | null

	constructor (
		modelName: string,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	) {
		this.#modelName = modelName
		this.#callbacks = callbacks
		this.#mapper = mapper
	}

	abstract start (): Promise<void>

	get modelName () {
		return this.#modelName
	}

	get callbacks () {
		return Object.freeze(this.#callbacks)
	}

	get mapper () {
		return this.#mapper
	}

	protected async _shouldRun (key: string) {
		const cacheName = `streams-${key}`
		const cached = await Instance.get().cache.setInTransaction(cacheName, key, 30)
		if (cached[0]) return false
		return true
	}
}

type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }
export type DbChangeCallbacks<Model, Entity> = {
	created?: (data: { before: null, after: Entity }) => Promise<void>
	updated?: (data: { before: Entity, after: Entity, changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity, after: null }) => Promise<void>
}