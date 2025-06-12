import { PipeInput, PipeOutput, v } from 'valleyed'

import { BaseApiKeysUtility, BaseTokensUtility } from '../requests-auth'
import { mongoDbConfigPipe, kafkaConfigPipe, rabbitmqConfigPipe, redisConfigPipe, redisJobsConfigPipe } from '../schemas'

export const instanceSettingsPipe = v.object({
	app: v.object({
		id: v.defaults(v.string(), 'appId'),
		name: v.defaults(v.string(), 'appName'),
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
		memory: v.object({
			type: v.is('memory' as const),
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
	}),
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
	utils: v.defaults(
		v.object({
			hashSaltRounds: v.defaults(v.number(), 10),
		}),
		{},
	),
})

export type Settings = PipeOutput<typeof instanceSettingsPipe>
export type SettingsInput = PipeInput<typeof instanceSettingsPipe>
