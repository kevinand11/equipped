import type { Events } from '../../types'

export type StreamOptions = { skipScope?: boolean; fanout: boolean }

export type Stream<EventData> = {
	publish: (data: EventData) => Promise<boolean>
	subscribe: (onMessage: (data: EventData) => Promise<void>) => void
}

export type EventBus = {
	stream<Event extends Events[keyof Events]>(topic: Event['topic'], options?: Partial<StreamOptions>): Stream<Event['data']>
}
