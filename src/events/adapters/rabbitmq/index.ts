import { connect } from 'amqp-connection-manager'
import type { ConfirmChannel } from 'amqplib'
import { v } from 'valleyed'

import { Instance } from '../../../instance'
import { configurable, parseJSONValue, Random } from '../../../utilities'
import { type EventBus } from '../base'

export const rabbitmqConfigPipe = () =>
	v.meta(
		v.object({
			uri: v.string(),
			eventColumnName: v.string(),
		}),
		{ title: 'Rabbitmq Config', $refId: 'RabbitmqConfig' },
	)

export const RabbitMQEventBus = configurable(rabbitmqConfigPipe, (config): EventBus => {
	const columnName = config.eventColumnName
	const client = connect([config.uri]).createChannel({
		json: false,
		setup: async (channel: ConfirmChannel) => {
			await channel.assertExchange(columnName, 'direct', { durable: true })
			await channel.prefetch(1)
		},
	})

	const eventBus: EventBus = {
		stream: (topicName, options = {}) => {
			const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)

			return {
				publish: async (data) => await client.publish(columnName, topic, JSON.stringify(data), { persistent: true }),
				subscribe: async (onMessage) => {
					const subscribe = async () => {
						await client.addSetup(async (channel: ConfirmChannel) => {
							const queueName = options.fanout
								? Instance.get().getScopedName(`${Instance.get().id}-fanout-${Random.string(10)}`)
								: topic
							const { queue } = await channel.assertQueue(queueName, { durable: !options.fanout, exclusive: options.fanout })
							await channel.bindQueue(queue, columnName, topic)
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
		},
	}

	return eventBus
})
