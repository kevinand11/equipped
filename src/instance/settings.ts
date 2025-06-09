import { PipeOutput, v } from 'valleyed'

import { BaseApiKeysUtility, BaseTokensUtility } from '../requests-auth'

export const settingsPipe = v.object({
	app: v.defaults(v.string(), 'app'),
	appId: v.defaults(v.string(), 'appId'),
	bullQueueName: v.defaults(v.string(), 'appTasksQueue'),
	eventColumnName: v.defaults(v.string(), 'appEventsColumn'),
	hashSaltRounds: v.defaults(v.number(), 10),
	logLevel: v.defaults(v.string().pipe(v.in(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const)), 'info'),
	debeziumUrl: v.string(),
	mongoDbURI: v.string(),
	rabbitURI: v.defaults(v.string(), ''),
	kafka: v.object({
		brokers: v.defaults(v.array(v.string()), []),
		ssl: v.optional(v.boolean()),
		sasl: v.optional(
			v.object({
				mechanism: v.string().pipe(v.eq('plain' as const)),
				username: v.string(),
				password: v.string(),
			}),
		),
		confluent: v.optional(v.boolean()),
	}),
	redis: v.object({
		host: v.optional(v.string()),
		port: v.optional(v.number()),
		password: v.optional(v.string()),
		username: v.optional(v.string()),
		tls: v.optional(v.boolean()),
		cluster: v.optional(v.boolean()),
	}),
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
	server: v.defaults(
		v.object({
			type: v.defaults(v.in(['fastify', 'express'] as const), 'fastify'),
			publicPath: v.optional(v.string()),
			healthPath: v.optional(v.string()),
		}),
		{},
	),
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
})

export type Settings = PipeOutput<typeof settingsPipe>
