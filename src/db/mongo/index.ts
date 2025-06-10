import { ClientSession, CollectionInfo, MongoClient, ObjectId } from 'mongodb'

import { getTable } from './api'
import { MongoDbChange } from './changes'
import { Instance } from '../../instance'
import { MongoDbConfig } from '../../schemas'
import { Db, type Config } from '../base/_instance'
import * as core from '../base/core'

export class MongoDb extends Db<{ _id: string }> {
	#client: MongoClient
	#started = false
	#cols: { db: string; col: string }[] = []

	constructor(private config: MongoDbConfig) {
		super()
		this.#client = new MongoClient(config.uri)
		Instance.addHook(
			'pre:start',
			async () => {
				if (this.#started) return
				this.#started = true
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
		Instance.addHook('pre:close', async () => this.#client.close(), 1)
	}

	async session<T>(callback: (session: ClientSession) => Promise<T>) {
		return this.#client.withSession(callback)
	}

	id() {
		return new ObjectId()
	}

	use<Model extends core.Model<{ _id: string }>, Entity extends core.Entity>(config: Config<Model, Entity>) {
		config.change
			? new MongoDbChange<Model, Entity>(
					this.config,
					this.#client,
					this.getScopedDb(config.db),
					config.col,
					config.change,
					config.mapper,
				)
			: null
		this.#cols.push({ db: this.getScopedDb(config.db), col: config.col })
		const collection = this.#client.db(this.getScopedDb(config.db)).collection<Model>(config.col)
		return getTable(collection, config)
	}
}
