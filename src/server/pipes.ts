import { PipeOutput, v } from 'valleyed'

import { EventBus } from '../events'

export const serverConfigPipe = v.object({
	type: v.in(['fastify', 'express'] as const),
	port: v.number(),
	eventBus: v.optional(v.instanceOf(EventBus)),
})

export type ServerConfig = PipeOutput<typeof serverConfigPipe>
