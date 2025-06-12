import { KafkaEventBus } from '../../events/kafka'

export type DbChangeConfig = {
	eventBus: KafkaEventBus
	debeziumUrl: string
}

export type DbConfig = {
	changes?: DbChangeConfig
}
