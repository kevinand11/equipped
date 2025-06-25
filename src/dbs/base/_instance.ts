import axios from 'axios'

import * as core from './core'
import { DbChangeConfig, DbConfig } from './types'
import { EquippedError } from '../../errors'
import { Instance } from '../../instance'

export const TopicPrefix = 'db-changes'

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

export abstract class DbChange<Model extends core.Model<core.IdType>, Entity extends core.Entity> {
	#callbacks: core.DbChangeCallbacks<Model, Entity> = {}
	#mapper: (model: Model) => Entity

	constructor(
		private config: DbChangeConfig,
		callbacks: core.DbChangeCallbacks<Model, Entity>,
		mapper: (model: Model) => Entity,
	) {
		this.#callbacks = callbacks
		this.#mapper = mapper
	}

	get callbacks() {
		return Object.freeze(this.#callbacks)
	}

	get mapper() {
		return this.#mapper
	}

	protected async configureConnector(key: string, data: Record<string, string>) {
		const instance = axios.create({ baseURL: this.config.debeziumUrl })
		return await instance
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
			})
			.then(async () => {
				const topics = await instance.get(`/connectors/${key}/topics`)
				return topics.data[key]?.topics?.includes?.(key) ?? false
			})
			.catch((err) => {
				throw new EquippedError(`Failed to configure watcher`, { key }, err)
			})
	}
}
