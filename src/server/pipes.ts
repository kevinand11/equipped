import { PipeOutput, v } from 'valleyed'

import { EventBus } from '../events'
import { BaseApiKeysUtility, BaseTokensUtility } from './requests-auth'

export const serverConfigPipe = () =>
	v.object({
		type: v.in(['fastify', 'express'] as const),
		port: v.number(),
		eventBus: v.optional(v.instanceOf(EventBus)),
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
	})

export type ServerConfig = PipeOutput<ReturnType<typeof serverConfigPipe>>
