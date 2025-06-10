import pino from 'pino'
import { Pipe } from 'valleyed'

import { instanceSettingsPipe, Settings, SettingsInput } from './settings'
import { Cache } from '../cache'
import { RedisCache } from '../cache/types/redis-cache'
import { MongoDb } from '../db/mongo'
import { EquippedError } from '../errors'
import { EventBus } from '../events/'
import { KafkaEventBus } from '../events/kafka'
import { RabbitEventBus } from '../events/rabbit'
import { addWaitBeforeExit, exit } from '../exit'
import { RedisJob } from '../jobs'
import { Server } from '../server'
import { ExpressServer } from '../server/impls/express'
import { FastifyServer } from '../server/impls/fastify'

function createLogger(config: Settings['log']) {
	return pino<any>({
		level: config.level,
		serializers: {
			err: pino.stdSerializers.err,
			error: pino.stdSerializers.err,
			req: pino.stdSerializers.req,
			res: pino.stdSerializers.res,
		},
	})
}

function createCache(config: Settings['cache']): Cache {
	switch (config.type) {
		case 'redis':
			return new RedisCache(config.config)
		default:
			throw new EquippedError(`unsupported type`, { config })
	}
}

function createJobs(config: Settings['jobs']): RedisJob {
	return new RedisJob(config)
}

function createEventBus(config: Settings['eventBus']): EventBus {
	switch (config.type) {
		case 'kafka':
			return new KafkaEventBus(config.config)
		case 'rabbitmq':
			return new RabbitEventBus(config.config)
		default:
			throw new EquippedError(`unsupported type`, { config })
	}
}

function createServer(config: Settings['server']): Server {
	switch (config.type) {
		case 'express':
			return new ExpressServer()
		case 'fastify':
			return new FastifyServer()
		default:
			throw new EquippedError(`unsupported type`, { config })
	}
}

export class Instance<T extends object = object> {
	static #instance: Instance
	readonly envs: T
	readonly settings: Settings
	#logger: pino.Logger<any>
	#cache: Cache
	#job: RedisJob
	#eventBus: EventBus
	#server: Server
	#dbs: { mongo: MongoDb }

	private constructor(envsPipe: Pipe<any, T>, settings: SettingsInput | ((envs: T) => SettingsInput)) {
		const envValidity = envsPipe.safeParse(process.env)
		if (!envValidity.valid) {
			throw exit(
				new EquippedError(`Environment variables are not valid\n${envValidity.error.toString()}`, {
					messages: envValidity.error.messages,
				}),
			)
		}
		this.envs = Object.freeze(envValidity.value)
		const settingsValidity = instanceSettingsPipe.safeParse(typeof settings === 'function' ? settings(this.envs) : settings)
		if (!settingsValidity.valid) {
			throw exit(
				new EquippedError(`Settings are not valid\n${settingsValidity.error.toString()}`, {
					messages: settingsValidity.error.messages,
				}),
			)
		}
		this.settings = Object.freeze(settingsValidity.value)
		this.#logger = createLogger(this.settings.log)
		this.#cache = createCache(this.settings.cache)
		this.#job = createJobs(this.settings.jobs)
		this.#dbs = {
			mongo: new MongoDb(this.settings.db.mongo),
		}
		this.#eventBus = createEventBus(this.settings.eventBus)
		this.#server = createServer(this.settings.server)
		Instance.#instance = this
	}

	static create<T extends object = object>(envsPipe: Pipe<any, T>, settings: SettingsInput | ((envs: T) => SettingsInput)) {
		if (Instance.#instance) throw exit(new EquippedError('An instance has already been created. Use that instead', {}))
		return new Instance(envsPipe, settings)
	}

	static get() {
		if (!Instance.#instance)
			return exit(
				new EquippedError('Has not been initialized. Make sure an instance has been created before you get an instance', {}),
			)
		return Instance.#instance
	}

	get logger() {
		return this.#logger
	}

	get cache() {
		return this.#cache
	}

	get job() {
		return this.#job
	}

	get dbs() {
		return this.#dbs
	}

	get eventBus() {
		return this.#eventBus
	}

	get server() {
		return this.#server
	}

	get listener() {
		return this.server.listener
	}

	getScopedName(name: string, key = '.') {
		return [this.settings.app, name].join(key)
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
		} catch (error) {
			exit(new EquippedError(`Error starting connections`, {}, error))
		}
	}
}
