import { ConditionalObjectKeys, PipeInput, PipeOutput, v } from 'valleyed'

import { InMemoryCache, RedisCache, redisConfigPipe } from '../cache'
import { MongoDb, mongoDbConfigPipe } from '../dbs'
import { KafkaEventBus, RabbitMQEventBus, kafkaConfigPipe, rabbitmqConfigPipe } from '../events'
import { RedisJob, redisJobsConfigPipe } from '../jobs'
import { BaseApiKeysUtility, BaseTokensUtility, ExpressServer, FastifyServer, serverConfigPipe } from '../server'

export const instanceSettingsPipe = () =>
	v.object({
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
		server: v.defaults(
			v.object({
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
			{},
		),
		utils: v.defaults(
			v.object({
				hashSaltRounds: v.defaults(v.number(), 10),
			}),
			{},
		),
	})

export type Settings = PipeOutput<ReturnType<typeof instanceSettingsPipe>>
export type SettingsInput = ConditionalObjectKeys<PipeInput<ReturnType<typeof instanceSettingsPipe>>>

export type CacheTypes = {
	'in-memory': InMemoryCache
	redis: RedisCache
}

export const cachePipe = () =>
	v.discriminate((e) => e?.type, {
		'in-memory': v.object({ type: v.is('in-memory' as const) }).pipe(() => new InMemoryCache()),
		redis: v
			.merge(redisConfigPipe(), v.object({ type: v.is('redis' as const) }))
			.pipe(({ type: _, ...config }) => new RedisCache(config)),
	})

export type JobTypes = {
	redis: RedisJob
}

export const jobsPipe = () =>
	v.discriminate((e) => e?.type, {
		redis: v
			.merge(redisJobsConfigPipe(), v.object({ type: v.is('redis' as const) }))
			.pipe(({ type: _, ...config }) => new RedisJob(config)),
	})

export type EventBusTypes = {
	kafka: KafkaEventBus
	rabbitmq: RabbitMQEventBus
}

export const eventBusPipe = () =>
	v.discriminate((e: any) => e?.type, {
		kafka: v
			.merge(kafkaConfigPipe(), v.object({ type: v.is('kafka' as const) }))
			.pipe(({ type: _, ...config }) => new KafkaEventBus(config)),
		rabbitmq: v
			.merge(rabbitmqConfigPipe(), v.object({ type: v.is('rabbitmq' as const) }))
			.pipe(({ type: _, ...config }) => new RabbitMQEventBus(config)),
	})

export type DbTypes = {
	mongo: MongoDb
}

export const dbPipe = () =>
	v
		.object({
			db: v.discriminate((e) => e?.type, {
				mongo: v.merge(mongoDbConfigPipe(), v.object({ type: v.is('mongo' as const) })),
			}),
			changes: v.optional(
				v.object({
					debeziumUrl: v.string(),
					eventBus: v.instanceOf(KafkaEventBus),
				}),
			),
		})
		.pipe((config) => new MongoDb(config.db, { changes: config.changes }))

export type ServerTypes = {
	express: ExpressServer
	fastify: FastifyServer
}

export const serverTypePipe = () =>
	serverConfigPipe().pipe((config) => (config.type === 'express' ? new ExpressServer(config) : new FastifyServer(config)))
