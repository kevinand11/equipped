import { Events } from '../types'

export type PublishOptions = { skipScope?: boolean }
export type SubscribeOptions = PublishOptions & { fanout: boolean }

export abstract class EventBus {
	abstract createPublisher<Event extends Events[keyof Events]>(
		topic: Event['topic'],
		options?: Partial<SubscribeOptions>,
	): (data: Event['data']) => Promise<boolean>

	abstract createSubscriber<Event extends Events[keyof Events]>(
		topic: Event['topic'],
		onMessage: (data: Event['data']) => Promise<void>,
		options?: Partial<SubscribeOptions>,
	): void
}

export const DefaultSubscribeOptions = {
	fanout: false,
}
