import { type PipeOutput, v } from 'valleyed'

import { EventBus } from '../events'
import type { AuthUser } from '../types'
import { BaseRequestAuthMethod } from './requests-auth-methods'

const serverBasePipe = () =>
	v.object({
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
		socketsAuthMethods: v.defaults(v.array(v.instanceOf(BaseRequestAuthMethod<AuthUser>)), []),
	})

export const serverConfigPipe = () =>
	v.discriminate((d: any) => d.type, {
		fastify: v.merge(
			serverBasePipe(),
			v.object({
				type: v.is('fastify' as const),
			}),
		),
		express: v.merge(
			serverBasePipe(),
			v.object({
				type: v.is('express' as const),
			}),
		),
	})

export type ServerConfig = PipeOutput<ReturnType<typeof serverConfigPipe>>
