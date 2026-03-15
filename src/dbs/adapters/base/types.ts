import { v, type PipeOutput } from 'valleyed'

import { KafkaEventBus } from '../../../events/adapters/kafka'

export const dbChangeConfigPipe = () =>
	v.object({
		debeziumUrl: v.string(),
		eventBus: v.instanceOf(KafkaEventBus),
	})

export type DbChangeConfig = PipeOutput<ReturnType<typeof dbChangeConfigPipe>>

export type DbConfig = {
	changes?: DbChangeConfig
}
