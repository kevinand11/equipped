import { PipeOutput, v } from 'valleyed'

import { redisConfigPipe } from '../cache'

export const redisJobsConfigPipe = v
	.objectTrim(
		v.object({
			redisConfig: redisConfigPipe,
			queueName: v.string(),
		}),
	)
	.meta({ title: 'Redis Jobs Config', $refId: 'RedisJobsConfig' })

export type RedisJobConfig = PipeOutput<typeof redisJobsConfigPipe>
