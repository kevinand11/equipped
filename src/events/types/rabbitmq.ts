import type { ChannelWrapper } from 'amqp-connection-manager'
import { connect } from 'amqp-connection-manager'
import type { ConfirmChannel } from 'amqplib'

import { Instance } from '../../instance'
import type { Events } from '../../types'
import { Random, parseJSONValue } from '../../utilities'
import { EventBus, type StreamOptions } from '../base'
import type { RabbitMQConfig } from '../pipes'

export class RabbitMQEventBus extends EventBus {
	#client: ChannelWrapper
	#columnName: string

	constructor(config: RabbitMQConfig) {
		super()
		this.#columnName = config.eventColumnName
		this.#client = connect([config.uri]).createChannel({
			json: false,
			setup: async (channel: ConfirmChannel) => {
				await channel.assertExchange(this.#columnName, 'direct', { durable: true })
				await channel.prefetch(1)
			},
		})
	}

	createStream<Event extends Events[keyof Events]>(topicName: Event['topic'], options: Partial<StreamOptions> = {}) {
		const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)
		return {
			publish: async (data: Event['data']) =>
				await this.#client.publish(this.#columnName, topic, JSON.stringify(data), { persistent: true }),
			subscribe: async (onMessage: (data: Event['data']) => Promise<void>) => {
				const subscribe = async () => {
					await this.#client.addSetup(async (channel: ConfirmChannel) => {
						const queueName = options.fanout
							? Instance.get().getScopedName(`${Instance.get().id}-fanout-${Random.string(10)}`)
							: topic
						const { queue } = await channel.assertQueue(queueName, { durable: !options.fanout, exclusive: options.fanout })
						await channel.bindQueue(queue, this.#columnName, topic)
						channel.consume(
							queue,
							async (msg) => {
								await Instance.resolveBeforeCrash(async () => {
									if (!msg) return
									try {
										await onMessage(parseJSONValue(msg.content.toString()))
										channel.ack(msg)
									} catch {
										channel.nack(msg)
									}
								})
							},
							{ noAck: false },
						)
					})
				}

				Instance.on('start', subscribe, 2)
			},
		}
	}
}
