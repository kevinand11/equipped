import { IEventTypes, Enum } from '../enums/types'
import { pubAndSub } from './rabbit'

export interface Events extends Record<Enum<IEventTypes>, { topic: Enum<IEventTypes>, data: any }> { }

export class EventBus {
	ps: ReturnType<typeof pubAndSub>

	constructor () {
		this.ps = pubAndSub()
	}

	createPublisher<Event extends Events[keyof Events]> (topic: Event['topic']) {
		const { ps } = this

		const publish = async (data: Event['data']) => {
			await (await ps).publish(topic as unknown as string, JSON.stringify(data))
		}

		return { publish }
	}

	createSubscriber<Event extends Events[keyof Events]> (topic: Event['topic'], onMessage: (data: Event['data']) => void) {
		const { ps } = this

		const subscribe = async () => {
			await (await ps).subscribe(topic as unknown as string, (data) => {
				onMessage(JSON.parse(data))
			})
		}

		return { subscribe }
	}
}