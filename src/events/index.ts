import type { Enum, IEventTypes } from '../enums/types'

export interface Events extends Record<Enum<IEventTypes>, { topic: Enum<IEventTypes>; data: any }> {}
export type PublishOptions = { skipScope?: boolean }
export type SubscribeOptions = PublishOptions & { fanout: boolean }

export abstract class EventBus {
	protected _subscribers: (() => Promise<void>)[] = []

	async startSubscribers() {
		return Promise.all(this._subscribers.map((sub) => sub()))
	}

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
