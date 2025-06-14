import { KafkaEventBus } from '../../events'

export type DbChangeConfig = {
	eventBus: KafkaEventBus
	debeziumUrl: string
}

export type DbConfig = {
	changes?: DbChangeConfig
}
