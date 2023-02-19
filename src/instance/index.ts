import { BullJob } from '../bull'
import { Cache } from '../cache/cache'
import { RedisCache } from '../cache/types/redis-cache'
import { MongoDb } from '../db/mongoose'
import { EventBus } from '../events/events'
import { addWaitBeforeExit, exit } from '../exit'
import { ConsoleLogger, Logger } from '../logger'
import { Server } from '../server/app'
import { defaulInstanceSetting, Settings } from './settings'

export class Instance {
	static #initialized = false
	static #instance: Instance
	#settings: Settings = { ...defaulInstanceSetting }
	#logger: Logger | null = null
	#job: BullJob | null = null
	#cache: Cache | null = null
	#eventBus: EventBus | null = null
	#server: Server | null = null
	#db: MongoDb | null = null

	private constructor () {
	}

	get logger () {
		if (!this.#logger) this.#logger = new ConsoleLogger()
		return this.#logger
	}

	get job () {
		if (!this.#job) this.#job = new BullJob()
		return this.#job
	}

	get cache () {
		if (!this.#cache) this.#cache = new RedisCache(this.settings.redisURI)
		return this.#cache
	}

	get eventBus () {
		if (!this.#eventBus) this.#eventBus = new EventBus()
		return this.#eventBus
	}

	get server () {
		if (!this.#server) this.#server = new Server()
		return this.#server
	}

	get db () {
		if (!this.#db) this.#db = new MongoDb()
		return this.#db
	}

	get listener () {
		return this.server.listener
	}

	get settings () {
		return this.#settings
	}

	static initialize (settings: Partial<Settings>) {
		Instance.#initialized = true
		const instanceSettings = Instance.get().settings
		Object.entries(settings).forEach(([key, value]) => {
			instanceSettings[key] = value
		})
	}

	static get () {
		if (!this.#initialized) return exit('Has not been initialized. Make sure initialize is called before you get an instance')
		if (!Instance.#instance) Instance.#instance = new Instance()
		return Instance.#instance
	}

	async startConnections () {
		try {
			await Instance.get().db.start(this.settings.mongoDbURI)
			await Instance.get().cache.connect()
			await Instance.get().db.startAllDbChanges()
			addWaitBeforeExit(Instance.get().db.close)
			addWaitBeforeExit(Instance.get().cache.close)
		} catch (error: any) {
			exit(`'Error starting connections: ${error}`)
		}
	}
}