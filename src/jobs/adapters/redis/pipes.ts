import { type PipeInput, v } from 'valleyed'

import { redisConfigPipe } from '../../../cache/adapters/redis'

export const redisJobsConfigPipe = () =>
	v.meta(
		v.object({
			redisConfig: redisConfigPipe(),
			queueName: v.string(),
		}),
		{ title: 'Redis Jobs Config', $refId: 'RedisJobsConfig' },
	)

export type RedisJobConfig = PipeInput<ReturnType<typeof redisJobsConfigPipe>>
