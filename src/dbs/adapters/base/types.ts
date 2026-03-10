import type { EventBus } from '../../../events'

export type DbChangeConfig = {
	eventBus: EventBus
	debeziumUrl: string
}

export type DbConfig = {
	changes?: DbChangeConfig
}
