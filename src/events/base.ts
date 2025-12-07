import type { Events } from '../types'

export type StreamOptions = { skipScope?: boolean; fanout: boolean }

export abstract class EventBus {
	abstract createStream<Event extends Events[keyof Events]>(
		topic: Event['topic'],
		options?: Partial<StreamOptions>,
	): {
		publish: (data: Event['data']) => Promise<boolean>
		subscribe: (onMessage: (data: Event['data']) => Promise<void>) => void
	}
}
