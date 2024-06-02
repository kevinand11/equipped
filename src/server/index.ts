export * from './middlewares'
export * from './requests'
export * from './routes'
export * from './types'

import { Server } from './impls/base'
import { ExpressServer } from './impls/express'
import { FastifyServer } from './impls/fastify'

export type { Server }

export type ServerTypes = 'express' | 'fastify'

export const serverTypes: Record<ServerTypes, () => Server> = {
	express: () => new ExpressServer(),
	fastify: () => new FastifyServer(),
}