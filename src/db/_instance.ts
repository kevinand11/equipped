import { BaseEntity } from '../structure'
import { QueryParams, QueryResults } from './query'

export abstract class Db {
	#dbChanges = [] as DbChange<any, any>[]

	abstract generateDbChange<Model, Entity extends BaseEntity> (
		collection: any,
		callbacks: DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model | null) => Entity | null
	): DbChange<Model, Entity>

	abstract parseQueryParams<Model> (
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

	abstract start (url: string): Promise<void>
	abstract close (): Promise<void>
}

export abstract class DbChange<Model, Entity extends BaseEntity> {
	_cbs: DbChangeCallbacks<Model, Entity> = {}
	abstract start (...args: any[]): Promise<void>

	setCallbacks (callbacks: DbChangeCallbacks<Model, Entity>) {
		this._cbs.created = callbacks.created
		this._cbs.updated = callbacks.updated
		this._cbs.deleted = callbacks.deleted
		return this
	}
}

type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }
export type DbChangeCallbacks<Model, Entity> = {
	created?: (data: { before: null, after: Entity }) => Promise<void>
	updated?: (data: { before: Entity, after: Entity, changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity, after: null }) => Promise<void>
}