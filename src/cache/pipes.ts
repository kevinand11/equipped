import { v, PipeOutput } from 'valleyed'

export const redisConfigPipe = v
	.objectTrim(
		v.object({
			host: v.string(),
			port: v.optional(v.number()),
			password: v.optional(v.string()),
			username: v.optional(v.string()),
			tls: v.optional(v.boolean()),
			cluster: v.optional(v.boolean()),
		}),
	)
	.meta({ title: 'Redis Config', $refId: 'RedisConfig' })

export type RedisConfig = PipeOutput<typeof redisConfigPipe>
