import Confluent from '@confluentinc/kafka-javascript'
import Kafka from 'kafkajs'

import { Instance } from '../../instance'
import type { Events } from '../../types'
import { Random, parseJSONValue } from '../../utilities'
import { EventBus, StreamOptions } from '../base'
import { KafkaConfig } from '../pipes'

export class KafkaEventBus extends EventBus {
	#client: Kafka.Kafka | Confluent.KafkaJS.Kafka
	#confluent: boolean
	#admin: Kafka.Admin | Confluent.KafkaJS.Admin | undefined
	constructor(config: KafkaConfig) {
		super()
		const { confluent = false, ...kafkaSettings } = config
		this.#confluent = confluent
		this.#client = confluent
			? new Confluent.KafkaJS.Kafka({
					kafkaJS: { ...kafkaSettings, logLevel: Confluent.KafkaJS.logLevel.NOTHING },
				})
			: new Kafka.Kafka({ ...kafkaSettings, logLevel: Kafka.logLevel.NOTHING })
	}

	createStream<Event extends Events[keyof Events]>(topicName: Event['topic'], options: Partial<StreamOptions> = {}) {
		const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)
		return {
			publish: async (data: Event['data']) => {
				try {
					const producer = this.#client.producer()
					await producer.connect()
					await producer.send({
						topic,
						messages: [{ value: JSON.stringify(data) }],
					})
					return true
				} catch {
					return false
				}
			},
			subscribe: (onMessage: (data: Event['data']) => Promise<void>) => {
				const subscribe = async () => {
					await this.#createTopic(topic)
					const groupId = options.fanout
						? Instance.get().getScopedName(`${Instance.get().id}-fanout-${Random.string(10)}`)
						: topic
					const consumer = this.#client.consumer(this.#confluent ? ({ kafkaJS: { groupId } } as any) : { groupId })

					await consumer.connect()
					await consumer.subscribe({ topic })

					await consumer.run({
						eachMessage: async ({ message }) => {
							Instance.resolveBeforeCrash(async () => {
								if (!message.value) return
								await onMessage(parseJSONValue(message.value.toString()))
							})
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
		if (!this.#admin) {
			this.#admin = this.#client.admin()
			await this.#admin.connect()
		}
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
