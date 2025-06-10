import pino from 'pino'
import { Pipe } from 'valleyed'

import { HookCb, HookEvent, HookRecord, runHooks } from './hooks'
import { instanceSettingsPipe, Settings, SettingsInput } from './settings'
import { Cache } from '../cache'
import { RedisCache } from '../cache/types/redis-cache'
import { MongoDb } from '../db/mongo'
import { EquippedError } from '../errors'
import { EventBus } from '../events/'
import { KafkaEventBus } from '../events/kafka'
import { RabbitEventBus } from '../events/rabbit'
import { RedisJob } from '../jobs'
import { Listener } from '../listeners'
import { Server } from '../server/impls/base'
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
	static #hooks: Partial<Record<HookEvent, HookRecord[]>> = {}
	readonly envs: T
	readonly settings: Settings
	readonly logger: pino.Logger<any>
	readonly cache: Cache
	readonly jobs: RedisJob
	readonly eventBus: EventBus
	readonly server: Server
	readonly dbs: { mongo: MongoDb }
	readonly dbChangesEventBus: KafkaEventBus
	readonly listener: Listener

	private constructor(envsPipe: Pipe<any, T>, settings: SettingsInput | ((envs: T) => SettingsInput)) {
		Instance.#instance = this
		const envValidity = envsPipe.safeParse(process.env)
		if (!envValidity.valid) {
			Instance.crash(
				new EquippedError(`Environment variables are not valid\n${envValidity.error.toString()}`, {
					messages: envValidity.error.messages,
				}),
			)
		}
		this.envs = Object.freeze(envValidity.value)
		const settingsValidity = instanceSettingsPipe.safeParse(typeof settings === 'function' ? settings(this.envs) : settings)
		if (!settingsValidity.valid) {
			Instance.crash(
				new EquippedError(`Settings are not valid\n${settingsValidity.error.toString()}`, {
					messages: settingsValidity.error.messages,
				}),
			)
		}
		this.settings = Object.freeze(settingsValidity.value)
		this.logger = createLogger(this.settings.log)
		this.cache = createCache(this.settings.cache)
		this.jobs = createJobs(this.settings.jobs)
		this.dbs = {
			mongo: new MongoDb(this.settings.dbs.mongo),
		}
		this.eventBus = createEventBus(this.settings.eventBus)
		this.server = createServer(this.settings.server)
		this.dbChangesEventBus = new KafkaEventBus(this.settings.dbChanges.kafkaConfig)
		this.listener = new Listener(this.server.socket)
		Instance.#registerOnExitHandler()
	}

	getScopedName(name: string, key = '.') {
		return [this.settings.app.name, name].join(key)
	}

	async start() {
		try {
			await runHooks(Instance.#hooks['pre:start'] ?? [])
			await runHooks(Instance.#hooks['post:start'] ?? [])
		} catch (error) {
			Instance.crash(new EquippedError(`Error starting instance`, {}, error))
		}
	}

	static create<T extends object = object>(envsPipe: Pipe<any, T>, settings: SettingsInput | ((envs: T) => SettingsInput)) {
		if (Instance.#instance) throw Instance.crash(new EquippedError('An instance has already been created. Use that instead', {}))
		return new Instance(envsPipe, settings)
	}

	static get() {
		if (!Instance.#instance)
			return Instance.crash(
				new EquippedError('Has not been initialized. Make sure an instance has been created before you get an instance', {}),
			)
		return Instance.#instance
	}

	static addHook(event: HookEvent, cb: HookCb, order: number) {
		Instance.#hooks[event] ??= []
		Instance.#hooks[event].push({ cb, order })
	}

	static #registerOnExitHandler() {
		const signals = {
			SIGHUP: 1,
			SIGINT: 2,
			SIGTERM: 15,
		}

		Object.entries(signals).forEach(([signal, code]) => {
			process.on(signal, async () => {
				await runHooks(Instance.#hooks['pre:close'] ?? [], () => {})
				process.exit(128 + code)
			})
		})
	}

	static resolveBeforeCrash<T>(cb: () => Promise<T>) {
		const value = cb()
		Instance.addHook('pre:close', async () => await value, 10)
		return value
	}

	static crash(error: EquippedError): never {
		// eslint-disable-next-line no-console
		console.error(error)
		process.exit(1)
	}
}
