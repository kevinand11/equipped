import type { KafkaEventBus } from '../../../events/adapters/kafka'

export type DbChangeConfig = {
	eventBus: KafkaEventBus
	debeziumUrl: string
}

export type DbConfig = {
	changes?: DbChangeConfig
}
