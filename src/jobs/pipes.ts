import { PipeOutput, v } from 'valleyed'

import { redisConfigPipe } from '../cache'

export const redisJobsConfigPipe = () =>
	v.meta(
		v.object({
			redisConfig: redisConfigPipe(),
			queueName: v.string(),
		}),
		{ title: 'Redis Jobs Config', $refId: 'RedisJobsConfig' },
	)

export type RedisJobConfig = PipeOutput<ReturnType<typeof redisJobsConfigPipe>>
