import { type FastifyCorsOptions } from '@fastify/cors'
import { type CorsOptions } from 'cors'
import type TestAgent from 'supertest/lib/agent'
import { v, type PipeOutput } from 'valleyed'

import { EventBus } from '../../events'
import type { AuthUser } from '../../types'
import { BaseRequestAuthMethod } from '../requests-auth-methods'
import { Router } from '../routes'
import { SocketEmitter } from '../sockets'
import { Methods, type Route, type RouteDef } from '../types'

export const serverConfigPipe = () =>
	v.object({
		port: v.number(),
		cors: v.optional(
			v.object({
				origin: v.optional(v.or([v.array(v.string()), v.is(true as const)])),
				methods: v.optional(v.array(v.in(Object.values(Methods)))),
				credentials: v.optional(v.boolean()),
			}),
		),
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

export type ServerConfig = PipeOutput<ReturnType<typeof serverConfigPipe>>

export interface Server {
	addRouter(...routers: Router<any>[]): void
	addRoute<T extends RouteDef>(...routes: Route<T>[]): void
	socket: SocketEmitter
	test: () => TestAgent
	cors: CorsOptions & FastifyCorsOptions
	start(port: number): Promise<boolean>
}
