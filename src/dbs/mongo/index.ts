import { ClientSession, CollectionInfo, MongoClient, ObjectId } from 'mongodb'

import { getTable } from './api'
import { MongoDbConfig } from '../pipes'
import { MongoDbChange } from './changes'
import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import { Db, type Config } from '../base/_instance'
import * as core from '../base/core'
import { DbConfig } from '../base/types'

export class MongoDb extends Db<{ _id: string }> {
	#client: MongoClient
	#cols: { db: string; col: string }[] = []

	constructor(
		private mongoConfig: MongoDbConfig,
		dbConfig: DbConfig,
	) {
		super(dbConfig)
		this.#client = new MongoClient(mongoConfig.uri)
		Instance.on(
			'pre:start',
			async () => {
				await this.#client.connect()

				const grouped = this.#cols.reduce<Record<string, string[]>>((acc, cur) => {
					if (!acc[cur.db]) acc[cur.db] = []
					acc[cur.db].push(cur.col)
					return acc
				}, {})

				const options = {
					changeStreamPreAndPostImages: { enabled: true },
				}
				await Promise.all(
					Object.entries(grouped).map(async ([dbName, colNames]) => {
						const db = this.#client.db(dbName)
						const collections = await db.listCollections<CollectionInfo>().toArray()
						return colNames.map(async (colName) => {
							const existing = collections.find((collection) => collection.name === colName)
							if (existing) {
								if (
									existing.options?.changeStreamPreAndPostImages?.enabled !== options.changeStreamPreAndPostImages.enabled
								)
									await db.command({ collMod: colName, ...options })
							} else await db.createCollection(colName, options)
						})
					}),
				)
			},
			1,
		)
		Instance.on('pre:close', async () => this.#client.close(), 1)
	}

	async session<T>(callback: (session: ClientSession) => Promise<T>) {
		return this.#client.withSession(callback)
	}

	id() {
		return new ObjectId()
	}

	use<Model extends core.Model<{ _id: string }>, Entity extends core.Entity>(config: Config<Model, Entity>) {
		if (config.change) {
			if (!this.config.changes) Instance.crash(new EquippedError('Db changes are not enabled in the configuration.', { config }))
			new MongoDbChange<Model, Entity>(
				this.mongoConfig,
				this.config.changes,
				this.#client,
				this.getScopedDb(config.db),
				config.col,
				config.change,
				config.mapper,
			)
		}
		this.#cols.push({ db: this.getScopedDb(config.db), col: config.col })
		const collection = this.#client.db(this.getScopedDb(config.db)).collection<Model>(config.col)
		return getTable(collection, config)
	}
}
