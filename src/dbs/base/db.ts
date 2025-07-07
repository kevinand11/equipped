import * as core from './core'
import { DbConfig } from './types'
import { Instance } from '../../instance'

export type TableOptions = { skipAudit?: boolean }

export abstract class Db<IdKey extends core.IdType> {
	constructor(protected config: DbConfig) {}

	protected getScopedDb(db: string) {
		return Instance.get().getScopedName(db).replaceAll('.', '-')
	}

	abstract use<Model extends core.Model<IdKey>, Entity extends core.Entity>(
		config: core.Config<Model, Entity>,
	): core.Table<IdKey, Model, Entity>
}
