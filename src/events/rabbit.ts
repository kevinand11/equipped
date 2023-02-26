import amqp, { ChannelWrapper } from 'amqp-connection-manager'
import { ConfirmChannel } from 'amqplib'
import { EventBus, Events, SubscribeOptions } from '.'
import { Instance } from '../instance'
import { parseJSONValue } from '../utils/json'

export class RabbitEventBus extends EventBus {
	#client: ChannelWrapper
	#columnName = Instance.get().settings.eventColumnName

	constructor () {
		super()
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
			return await this.#client.publish(this.#columnName, topic, JSON.stringify(data), { persistent: true })
		}

		return { publish }
	}

	createSubscriber<Event extends Events[keyof Events]> (topic: Event['topic'], onMessage: (data: Event['data']) => Promise<void>, options: Partial<SubscribeOptions> = {}) {
		const subscribe = async () => {
			await this.#client.addSetup(async (channel: ConfirmChannel) => {
				const queueName = options.fanout ? '' : `${Instance.get().settings.appId}-${topic}`
				const { queue } = await channel.assertQueue(queueName, { durable: !options.fanout, exclusive: options.fanout })
				await channel.bindQueue(queue, this.#columnName, topic)
				channel.consume(queue, async (msg) => {
					if (msg) {
						try {
							await onMessage(parseJSONValue(msg.content.toString()))
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