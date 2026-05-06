import { connect, type ChannelWrapper } from 'amqp-connection-manager'
import type { ConfirmChannel } from 'amqplib'
import { v, type PipeOutput } from 'valleyed'

import { Instance } from '../../../instance'
import type { Events } from '../../../types'
import { configurable, parseJSONValue, Random } from '../../../utilities'
import { EventBus, type Stream, type StreamOptions } from '../base'

export const rabbitmqConfigPipe = () =>
	v.meta(
		v.object({
			uri: v.string(),
			eventColumnName: v.string(),
		}),
		{ title: 'Rabbitmq Config', $refId: 'RabbitmqConfig' },
	)

export class RabbitMQEventBus extends configurable(
	rabbitmqConfigPipe,
	class extends EventBus {
		#client: ChannelWrapper
		#columnName: string
		constructor (config: PipeOutput<ReturnType<typeof rabbitmqConfigPipe>>) {
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

		stream<Event extends Events[keyof Events]>(topicName: Event['topic'], options: Partial<StreamOptions> = {}): Stream<Event['data']> {
			const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)

			return {
				publish: async (data) => await this.#client.publish(this.#columnName, topic, JSON.stringify(data), { persistent: true }),
				subscribe: async (onMessage) => {
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

					Instance.on('start', subscribe)
				},
			}
		}
}) {}
