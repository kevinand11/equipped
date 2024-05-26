export * from './middlewares'
export * from './request'
export { Router, groupRoutes, makeController, makeErrorMiddleware, makeMiddleware } from './routes'
export type { Route } from './routes'
export * from './statusCodes'

import { Server } from './impls/base'
import { ExpressServer } from './impls/express'
import { FastifyServer } from './impls/fastify'

export type { Server }

export type ServerTypes = 'express' | 'fastify'

export const serverTypes: Record<ServerTypes, () => Server> = {
	express: () => new ExpressServer(),
	fastify: () => new FastifyServer(),
}