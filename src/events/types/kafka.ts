import { KafkaJS } from '@confluentinc/kafka-javascript'

import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import type { Events } from '../../types'
import { Random, parseJSONValue } from '../../utilities'
import { EventBus, type StreamOptions } from '../base'
import type { KafkaConfig } from '../pipes'

export class KafkaEventBus extends EventBus {
	#client: KafkaJS.Kafka
	#admin: Promise<KafkaJS.Admin> | undefined
	constructor(config: KafkaConfig) {
		super()
		this.#client = new KafkaJS.Kafka({
			kafkaJS: { ...config, logLevel: KafkaJS.logLevel.NOTHING },
		})
	}

	createStream<Event extends Events[keyof Events]>(topicName: Event['topic'], options: Partial<StreamOptions> = {}) {
		const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)
		return {
			publish: async (data: Event['data']) => {
				const producer = this.#client.producer()
				await producer.connect()
				await producer.send({
					topic,
					messages: [{ value: JSON.stringify(data) }],
				})
				return true
			},
			subscribe: (onMessage: (data: Event['data']) => Promise<void>) => {
				const subscribe = async () => {
					await this.#createTopic(topic)
					const groupId = options.fanout
						? Instance.get().getScopedName(`${Instance.get().id}-fanout-${Random.string(10)}`)
						: topic
					const consumer = this.#client.consumer({ kafkaJS: { groupId } })

					await consumer.connect()
					await consumer.subscribe({ topic })

					await consumer.run({
						eachMessage: async ({ message }) => {
							await Instance.resolveBeforeCrash(async () => {
								if (!message.value) return
								await onMessage(parseJSONValue(message.value.toString()))
							}).catch((error) =>
								Instance.crash(new EquippedError('Error processing kafka event', { topic, groupId, options }, error)),
							)
						},
					})

					if (options.fanout)
						Instance.on(
							'close',
							async () => {
								await consumer.disconnect()
								await this.#deleteGroup(groupId)
							},
							10,
						)
				}
				Instance.on('start', subscribe, 2)
			},
		}
	}

	async #getAdmin() {
		if (!this.#admin)
			this.#admin = (async () => {
				const admin = this.#client.admin()
				await admin.connect()
				return admin
			})()
		return this.#admin
	}

	async #createTopic(topic: string) {
		const admin = await this.#getAdmin()
		await admin.createTopics({ topics: [{ topic }], timeout: 5000 })
	}

	async #deleteGroup(groupId: string) {
		const admin = await this.#getAdmin()
		await admin.deleteGroups([groupId]).catch(() => {})
	}
}
