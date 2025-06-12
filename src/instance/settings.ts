import pino, { Logger } from 'pino'
import { ConditionalObjectKeys, IsInTypeList, PipeInput, PipeOutput, v } from 'valleyed'

import { Cache } from '../cache'
import { RedisCache } from '../cache/types/redis-cache'
import { MongoDb } from '../db/mongo'
import { EventBus } from '../events'
import { KafkaEventBus } from '../events/kafka'
import { RabbitMQEventBus } from '../events/rabbitmq'
import { RedisJob } from '../jobs'
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
	dbs: v.optional(
		v.object({
			types: v.record(
				v.string(),
				v.discriminate((e) => e?.type, {
					mongo: v.objectExtends(mongoDbConfigPipe, { type: v.is('mongo' as const) }),
				}),
			),
			changes: v.object({
				debeziumUrl: v.string(),
				kafkaConfig: kafkaConfigPipe,
			}),
		}),
	),
	eventBus: v.optional(
		v.discriminate((e: any) => e?.type, {
			kafka: v.objectExtends(kafkaConfigPipe, { type: v.is('kafka' as const) }),
			rabbitmq: v.objectExtends(rabbitmqConfigPipe, { type: v.is('rabbitmq' as const) }),
		}),
	),
	cache: v.discriminate((e: any) => e?.type, {
		redis: v.objectExtends(redisConfigPipe, { type: v.is('redis' as const) }),
	}),
	jobs: v.optional(v.objectExtends(redisJobsConfigPipe, { type: v.is('redis' as const) })),
	server: v.optional(
		v.object({
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
	),
	utils: v.defaults(
		v.object({
			hashSaltRounds: v.defaults(v.number(), 10),
		}),
		{},
	),
})

export type Settings = PipeOutput<typeof instanceSettingsPipe>
export type SettingsInput = ConditionalObjectKeys<PipeInput<typeof instanceSettingsPipe>>

type DbTypesMap = { mongo: MongoDb }
type ReshapeDbs<T extends SettingsInput> =
	IsInTypeList<NonNullable<T['dbs']>['types'], [unknown]> extends true
		? {}
		: {
				[K in keyof NonNullable<T['dbs']>['types']]: NonNullable<T['dbs']>['types'][K] extends { type: keyof DbTypesMap }
					? DbTypesMap[NonNullable<T['dbs']>['types'][K]['type']]
					: never
			}

type AddUndefined<T, C> = IsInTypeList<C, [undefined, unknown]> extends true ? undefined : T
export type MapSettingsToInstance<T extends SettingsInput> = {
	app: T['app']
	log: Logger<any, boolean>
	eventBus: AddUndefined<EventBus, T['eventBus']>
	cache: AddUndefined<Cache, T['cache']>
	jobs: AddUndefined<RedisJob, T['jobs']>
	server: AddUndefined<Server, T['server']>
	dbs: ReshapeDbs<T>
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
	const cache = new RedisCache(settings.cache)
	const jobs = settings.jobs ? new RedisJob(settings.jobs) : undefined
	const eventBus =
		settings.eventBus?.type === 'kafka'
			? new KafkaEventBus(settings.eventBus)
			: settings.eventBus?.type === 'rabbitmq'
				? new RabbitMQEventBus(settings.eventBus)
				: undefined

	const serverConfig = {
		app: settings.app,
		log,
		eventBus,
	}
	const server =
		settings.server?.type === 'express'
			? new ExpressServer({ ...serverConfig, config: settings.server })
			: settings.server?.type === 'fastify'
				? new FastifyServer({ ...serverConfig, config: settings.server })
				: undefined

	const changesConfig = settings.dbs?.changes
		? {
				debeziumUrl: settings.dbs.changes.debeziumUrl,
				eventBus: new KafkaEventBus(settings.dbs.changes.kafkaConfig),
			}
		: undefined

	const dbs = Object.fromEntries(
		Object.entries(settings.dbs?.types ?? {}).map(([key, config]) => [
			key,
			config.type === 'mongo' ? new MongoDb(config, { changes: changesConfig }) : undefined,
		]),
	)

	return {
		app: settings.app,
		utils: settings.utils,
		log,
		eventBus: eventBus as any,
		cache: cache as any,
		jobs: jobs as any,
		server: server as any,
		dbs: dbs as any,
	}
}
