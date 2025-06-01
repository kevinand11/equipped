import { merge } from 'lodash'
import pino from 'pino'

import { BullJob } from '../bull-job'
import type { Cache } from '../cache/cache'
import { RedisCache } from '../cache/types/redis-cache'
import { MongoDb } from '../db/mongo'
import type { EventBus } from '../events/'
import { KafkaEventBus } from '../events/kafka'
import { addWaitBeforeExit, exit } from '../exit'
import type { Server } from '../server'
import { serverTypes } from '../server'
import { DeepPartial } from '../types'
import type { Settings } from './settings'
import { defaulInstanceSetting } from './settings'

export class Instance {
	static #initialized = false
	static #instance: Instance
	#settings: Settings = { ...defaulInstanceSetting }
	#logger: pino.Logger<any> | null = null
	#job: BullJob | null = null
	#cache: Cache | null = null
	#eventBus: EventBus | null = null
	#server: Server | null = null
	#dbs: { mongo: MongoDb } | null = null

	private constructor() {}

	get logger() {
		return (this.#logger ||= Instance.createLogger())
	}

	get job() {
		return (this.#job ||= new BullJob())
	}

	get cache() {
		return (this.#cache ||= new RedisCache())
	}

	get eventBus() {
		return (this.#eventBus ||= new KafkaEventBus())
	}

	get server() {
		return (this.#server ||= serverTypes[this.settings.server.type]())
	}

	get dbs() {
		return (this.#dbs ||= { mongo: new MongoDb() })
	}

	get listener() {
		return this.server.listener
	}

	get settings() {
		return this.#settings
	}

	getScopedName(name: string, key = '.') {
		return [this.settings.app, name].join(key)
	}

	static createLogger() {
		const defaultLogLevel = 'info'
		return pino<any>({
			level: Instance.#initialized ? (Instance.get().settings?.logLevel ?? defaultLogLevel) : defaultLogLevel,
			serializers: {
				err: pino.stdSerializers.err,
				error: pino.stdSerializers.err,
				req: pino.stdSerializers.req,
				res: pino.stdSerializers.res,
			},
		})
	}

	static initialize(settings: DeepPartial<Settings>) {
		Instance.#initialized = true
		const instance = Instance.get()
		instance.#settings = merge(instance.#settings, settings)
	}

	static get() {
		if (!this.#initialized) return exit('Has not been initialized. Make sure initialize is called before you get an instance')
		if (!Instance.#instance) Instance.#instance = new Instance()
		return Instance.#instance
	}

	async startConnections() {
		try {
			await Instance.get().cache.start()
			await Instance.get().listener.start()
			await Promise.all(
				Object.values(Instance.get().dbs).map(async (db) => {
					await db.start()
					await db.startAllDbChanges()
					addWaitBeforeExit(db.close)
				}),
			)
			await Instance.get().eventBus.startSubscribers()
			addWaitBeforeExit(Instance.get().cache.close)
		} catch (error: any) {
			exit(`Error starting connections: ${error}`)
		}
	}
}
