import { merge } from 'lodash'
import pino from 'pino'
import { Pipe } from 'valleyed'

import { BullJob } from '../bull-job'
import type { Cache } from '../cache/cache'
import { RedisCache } from '../cache/types/redis-cache'
import { MongoDb } from '../db/mongo'
import { EquippedError } from '../errors'
import type { EventBus } from '../events/'
import { KafkaEventBus } from '../events/kafka'
import { addWaitBeforeExit, exit } from '../exit'
import { serverTypes, type Server } from '../server'
import { defaulInstanceSetting, type Settings } from './settings'
import { DeepPartial } from '../types'

export class Instance<T extends object = object> {
	static #instance: Instance
	readonly envs: T = {} as T
	readonly settings: Settings = { ...defaulInstanceSetting }
	#logger: pino.Logger<any> | null = null
	#job: BullJob | null = null
	#cache: Cache | null = null
	#eventBus: EventBus | null = null
	#server: Server | null = null
	#dbs: { mongo: MongoDb } | null = null

	constructor(envsPipe: Pipe<any, T>, settings?: (envs: T) => DeepPartial<Settings> | DeepPartial<Settings>) {
		const envValidity = envsPipe.safeParse(process.env)
		if (!envValidity.valid) {
			return exit(
				new EquippedError(`Environment variables are not valid\n${envValidity.error.toString()}`, {
					messages: envValidity.error.messages,
				}),
			)
		}
		this.envs = Object.freeze(envValidity.value)
		this.settings = merge(this.settings, typeof settings === 'function' ? settings(this.envs) : (settings ?? {}))
		Instance.#instance = this
	}

	static get() {
		if (!Instance.#instance)
			return exit(new EquippedError('Has not been initialized. Make sure initialize is called before you get an instance', {}))
		return Instance.#instance
	}

	get logger() {
		return (this.#logger ||= pino<any>({
			level: 'info',
			serializers: {
				err: pino.stdSerializers.err,
				error: pino.stdSerializers.err,
				req: pino.stdSerializers.req,
				res: pino.stdSerializers.res,
			},
		}))
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
