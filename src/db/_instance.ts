import { BaseEntity } from '../structure'

export abstract class Db {
	#dbChanges = [] as DbChange<any, any>[]

	abstract generateDbChange<Model extends { _id: string }, Entity extends BaseEntity> (...args: any[]): DbChange<Model, Entity>

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
	abstract _cbs: Callbacks<Model, Entity>
	abstract start (...args: any[]): Promise<void>

	setCreated (callback: Exclude<Callbacks<Model, Entity>['created'], undefined>) {
		this._cbs.created = callback
		return this
	}

	setUpdated (callback: Exclude<Callbacks<Model, Entity>['updated'], undefined>) {
		this._cbs.updated = callback
		return this
	}

	setDeleted (callback: Exclude<Callbacks<Model, Entity>['deleted'], undefined>) {
		this._cbs.deleted = callback
		return this
	}
}

type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }
export type Callbacks<Model, Entity> = {
	created?: (data: { before: null, after: Entity }) => Promise<void>
	updated?: (data: { before: Entity, after: Entity, changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity, after: null }) => Promise<void>
}