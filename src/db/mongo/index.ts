import { ClientSession, CollectionInfo, MongoClient, ObjectId } from 'mongodb'

import { Instance } from '../../instance'
import type { Config } from '../_instance'
import { Db } from '../_instance'
import * as core from '../core'
import { getTable } from './api'
import { MongoDbChange } from './changes'

export class MongoDb extends Db<{ _id: string }> {
	#started = false
	#cols: { db: string; col: string }[] = []
	#client = new MongoClient(Instance.get().settings.mongoDbURI)

	async session<T>(callback: (session: ClientSession) => Promise<T>) {
		return this.#client.withSession(callback)
	}

	id () {
		return new ObjectId()
	}

	use<Model extends core.Model<{ _id: string }>, Entity extends core.Entity> (config: Config<Model, Entity>) {
		const change = config.change ? new MongoDbChange<Model, Entity>(this.#client, this.getScopedDb(config.db), config.col, config.change, config.mapper) : null
		if (change) this._addToDbChanges(change)
		this.#cols.push({ db: this.getScopedDb(config.db), col: config.col })
		const collection = this.#client.db(this.getScopedDb(config.db)).collection<Model>(config.col)
		return getTable<Model, Entity>(collection, config)
	}

	async start() {
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
		await Promise.all(Object.entries(grouped).map(async ([dbName, colNames]) => {
			const db = this.#client.db(dbName)
			const collections = await db.listCollections<CollectionInfo>().toArray()
			return colNames.map(async (colName) => {
				const existing = collections.find((collection) => collection.name === colName)
				if (existing) {
					if (existing.options?.changeStreamPreAndPostImages?.enabled !== options.changeStreamPreAndPostImages.enabled) await db.command({ collMod: colName, ...options })
				} else await db.createCollection(colName, options)
			})
		}))
	}

	async close () {
		await this.#client.close()
	}
}
