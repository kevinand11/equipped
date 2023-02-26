import { Enum, IEventTypes } from '../enums/types'

export interface Events extends Record<Enum<IEventTypes>, { topic: Enum<IEventTypes>, data: any }> { }
export type SubscribeOptions = { fanout: boolean }

export abstract class EventBus {
	abstract createPublisher<Event extends Events[keyof Events]> (topic: Event['topic']): {
		publish: (data: Event['data']) => Promise<boolean>
	}

	abstract createSubscriber<Event extends Events[keyof Events]> (topic: Event['topic'], onMessage: (data: Event['data']) => Promise<void>, options: Partial<SubscribeOptions>): {
		subscribe: () => Promise<void>
	}
}