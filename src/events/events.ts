import amqp, { ChannelWrapper } from 'amqp-connection-manager'
import { ConfirmChannel } from 'amqplib'
import { Enum, IEventTypes } from '../enums/types'
import { Instance } from '../instance'

export interface Events extends Record<Enum<IEventTypes>, { topic: Enum<IEventTypes>, data: any }> { }

export class EventBus {
	#client: ChannelWrapper
	#columnName = Instance.get().settings.rabbitColumnName

	constructor () {
		this.#client = amqp.connect([Instance.get().settings.rabbitURI])
			.createChannel({
				json: false,
				setup: async (channel: ConfirmChannel) => {
					await channel.assertExchange(this.#columnName, 'direct', { durable: true })
					await channel.prefetch(1)
				},
			})
	}

	createPublisher<Event extends Events[keyof Events]> (topic: Event['topic']) {
		const publish = async (data: Event['data']) => {
			await this.#client.publish(this.#columnName, topic, JSON.stringify(data), { persistent: true })
		}

		return { publish }
	}

	createSubscriber<Event extends Events[keyof Events]> (topic: Event['topic'], onMessage: (data: Event['data']) => Promise<void>) {
		const subscribe = async () => {
			await this.#client.addSetup(async (channel: ConfirmChannel) => {
				const queue = `${Instance.get().settings.appId}-${topic}`
				await channel.assertQueue(queue, { durable: true })
				await channel.bindQueue(queue, this.#columnName, topic)
				channel.consume(queue, async (msg) => {
					if (msg) {
						try {
							await onMessage(parse(msg.content.toString()))
							channel.ack(msg)
						} catch (err) {
							channel.nack(msg)
						}
					}
				}, { noAck: false })
			})
		}

		return { subscribe }
	}
}

const parse = (data: any) => {
	try {
		return JSON.parse(data)
	} catch {
		return data
	}
}