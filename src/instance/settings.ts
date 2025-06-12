import pino, { Logger } from 'pino'
import { PipeInput, PipeOutput, v } from 'valleyed'

import { Cache } from '../cache'
import { RedisCache } from '../cache/types/redis-cache'
import { EventBus } from '../events'
import { KafkaEventBus } from '../events/kafka'
import { RabbitEventBus } from '../events/rabbit'
import { RedisJob } from '../jobs'
import { Listener } from '../listeners'
import { mongoDbConfigPipe, kafkaConfigPipe, rabbitmqConfigPipe, redisConfigPipe, redisJobsConfigPipe } from '../schemas'
import { Server } from '../server/impls/base'
import { ExpressServer } from '../server/impls/express'
import { FastifyServer } from '../server/impls/fastify'
import { BaseApiKeysUtility, BaseTokensUtility } from '../server/requests-auth'

export const instanceSettingsPipe = v.object({
	app: v.object({
		id: v.string(),
		name: v.string(),
	}),
	log: v.defaults(
		v.object({
			level: v.defaults(v.in(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const), 'info'),
		}),
		{},
	),
	dbs: v.object({
		mongo: mongoDbConfigPipe,
	}),
	dbChanges: v.object({
		debeziumUrl: v.string(),
		kafkaConfig: kafkaConfigPipe,
	}),
	eventBus: v.discriminate((e: any) => e?.type, {
		kafka: v.object({
			type: v.is('kafka' as const),
			config: kafkaConfigPipe,
		}),
		rabbitmq: v.object({
			type: v.is('rabbitmq' as const),
			config: rabbitmqConfigPipe,
		}),
	}),
	cache: v.discriminate((e: any) => e?.type, {
		redis: v.object({
			type: v.is('redis' as const),
			config: redisConfigPipe,
		}),
	}),
	jobs: redisJobsConfigPipe,
	server: v.object({
		type: v.in(['fastify', 'express'] as const),
		port: v.number(),
		publicPath: v.optional(v.string()),
		healthPath: v.optional(v.string()),
		openapi: v.defaults(
			v.object({
				docsVersion: v.defaults(v.string(), '1.0.0'),
				docsBaseUrl: v.defaults(v.array(v.string()), ['/']),
				docsPath: v.defaults(v.string(), '/__docs'),
			}),
			{},
		),
		requests: v.defaults(
			v.object({
				log: v.defaults(v.boolean(), true),
				paginationDefaultLimit: v.defaults(v.number(), 100),
				maxFileUploadSizeInMb: v.defaults(v.number(), 500),
				rateLimit: v.defaults(
					v.object({
						enabled: v.defaults(v.boolean(), false),
						periodInMs: v.defaults(v.number(), 60 * 60 * 1000),
						limit: v.defaults(v.number(), 5000),
					}),
					{},
				),
				slowdown: v.defaults(
					v.object({
						enabled: v.defaults(v.boolean(), false),
						periodInMs: v.defaults(v.number(), 10 * 60 * 1000),
						delayAfter: v.defaults(v.number(), 2000),
						delayInMs: v.defaults(v.number(), 500),
					}),
					{},
				),
			}),
			{},
		),
		requestsAuth: v.defaults(
			v.object({
				tokens: v.optional(v.instanceOf(BaseTokensUtility)),
				apiKey: v.optional(v.instanceOf(BaseApiKeysUtility)),
			}),
			{},
		),
	}),
	utils: v.defaults(
		v.object({
			hashSaltRounds: v.defaults(v.number(), 10),
		}),
		{},
	),
})

export type Settings = PipeOutput<typeof instanceSettingsPipe>
export type SettingsInput = PipeInput<typeof instanceSettingsPipe>

export type MapSettingsToInstance<T extends Settings> = {
	app: T['app']
	log: Logger<any, boolean>
	eventBus: EventBus
	cache: Cache
	jobs: RedisJob
	server: Server
	listener: Listener
	dbChangesEventBus: KafkaEventBus
	utils: T['utils']
}

export function mapSettingsToInstance<T extends Settings>(settings: T): MapSettingsToInstance<T> {
	const log = pino<any>({
		level: settings.log.level,
		serializers: {
			err: pino.stdSerializers.err,
			error: pino.stdSerializers.err,
			req: pino.stdSerializers.req,
			res: pino.stdSerializers.res,
		},
	})
	const cache = new RedisCache(settings.cache.config)
	const jobs = new RedisJob(settings.jobs)
	const eventBus =
		settings.eventBus.type === 'kafka' ? new KafkaEventBus(settings.eventBus.config) : new RabbitEventBus(settings.eventBus.config)

	const serverConfig = {
		app: settings.app,
		config: settings.server,
		log,
	}
	const server = settings.server.type === 'express' ? new ExpressServer(serverConfig) : new FastifyServer(serverConfig)
	const listener = new Listener(server.socket)

	const dbChangesEventBus = new KafkaEventBus(settings.dbChanges.kafkaConfig)

	return {
		app: settings.app,
		utils: settings.utils,
		log,
		eventBus,
		cache,
		jobs,
		server,
		listener,
		dbChangesEventBus,
	}
}
