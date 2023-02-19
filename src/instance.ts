import { BullJob } from './bull'
import { Cache } from './cache/cache'
import { RedisCache } from './cache/types/redis-cache'
import { startAllDbChanges } from './db'
import { start, close } from './db/mongoose'
import { EventBus } from './events/events'
import { addWaitBeforeExit } from './exit'
import { Server } from './express/app'
import { ConsoleLogger, Logger } from './logger'

type Settings = {
	isDev: boolean
	accessTokenKey: string
	accessTokenTTL: number
	refreshTokenKey: string
	refreshTokenTTL: number
	mongoDbURI: string
	rabbitURI: string
	redisURI: string
	appId: string
	bullQueueName: string
	rabbitColumnName: string
	maxFileUploadSizeInMb: number
	useRateLimit: boolean
	rateLimitPeriodInMs: number
	rateLimit: number
	useSlowDown: boolean
	slowDownPeriodInMs: number
	slowDownAfter: number
	slowDownDelayInMs: number
	hashSaltRounds: number
	paginationDefaultLimit: number
}

const setting: Settings = {
	isDev: false,
	accessTokenKey: 'accessTokenKey',
	accessTokenTTL: 60 * 60,
	refreshTokenKey: 'refreshTokenKey',
	refreshTokenTTL: 14 * 24 * 60 * 60,
	mongoDbURI: '',
	rabbitURI: '',
	redisURI: '',
	appId: 'appId',
	bullQueueName: 'appTasksQueue',
	rabbitColumnName: 'appEventsColumn',
	maxFileUploadSizeInMb: 500,
	useRateLimit: false,
	rateLimitPeriodInMs: 60 * 60 * 1000,
	rateLimit: 2500,
	useSlowDown: false,
	slowDownPeriodInMs: 10 * 60 * 1000,
	slowDownAfter: 1000,
	slowDownDelayInMs: 500,
	hashSaltRounds: 10,
	paginationDefaultLimit: 100
}

export class Instance {
	static #initialized = false
	static #instance: Instance
	static #settings: Settings = setting
	#logger: Logger | null = null
	#job: BullJob | null = null
	#cache: Cache | null = null
	#eventBus: EventBus | null = null
	#server: Server | null = null

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

	get listener () {
		return this.server.listener
	}

	get settings () {
		return Instance.#settings
	}

	static initialize (settings: Partial<Settings>) {
		Object.entries(settings).forEach(([key, value]) => this.#settings[key] = value)
		Instance.#initialized = true
	}

	static get () {
		if (!this.#initialized) {
			// eslint-disable-next-line no-console
			console.error('Has not been initialized. Make sure initialize is called before you get an instance')
			process.exit(1)
		}
		if (!Instance.#instance) Instance.#instance = new Instance()
		return Instance.#instance
	}

	async startDbConnection () {
		try {
			await start(this.settings.mongoDbURI)
			await Instance.get().cache.connect()
			await startAllDbChanges()
			addWaitBeforeExit(close)
		} catch (error) {
			await Instance.get().logger.error('MongoDb failed with error:', error)
			process.exit(1)
		}
	}
}