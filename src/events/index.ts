import { Events } from '../types/overrides'

export type PublishOptions = { skipScope?: boolean }
export type SubscribeOptions = PublishOptions & { fanout: boolean }

export abstract class EventBus {
	abstract createPublisher<Event extends Events[keyof Events]>(
		topic: Event['topic'],
		options?: Partial<SubscribeOptions>,
	): {
		publish: (data: Event['data']) => Promise<boolean>
	}

	abstract createSubscriber<Event extends Events[keyof Events]>(
		topic: Event['topic'],
		onMessage: (data: Event['data']) => Promise<void>,
		options?: Partial<SubscribeOptions>,
	): {
		subscribe: () => Promise<void>
	}
}

export const DefaultSubscribeOptions = {
	fanout: false,
}
