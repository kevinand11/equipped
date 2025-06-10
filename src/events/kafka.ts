import Confluent from '@confluentinc/kafka-javascript'
import Kafka from 'kafkajs'

import type { PublishOptions, SubscribeOptions } from '.'
import { DefaultSubscribeOptions, EventBus } from '.'
import { addWaitBeforeExit } from '../exit'
import { Instance } from '../instance'
import { KafkaConfig } from '../schemas'
import type { Events } from '../types/overrides'
import { parseJSONValue } from '../utils/json'
import { Random } from '../utils/utils'

export class KafkaEventBus extends EventBus {
	#client: Kafka.Kafka | Confluent.KafkaJS.Kafka
	#confluent: boolean
	#admin: Kafka.Admin | Confluent.KafkaJS.Admin | undefined
	constructor(config: KafkaConfig) {
		super()
		const { confluent = false, ...kafkaSettings } = config
		this.#confluent = confluent
		const fullConfig = {
			...kafkaSettings,
			clientId: Instance.get().getScopedName(kafkaSettings.clientId),
		}
		this.#client = confluent
			? new Confluent.KafkaJS.Kafka({
					kafkaJS: { ...fullConfig, logLevel: Confluent.KafkaJS.logLevel.NOTHING },
				})
			: new Kafka.Kafka({ ...fullConfig, logLevel: Kafka.logLevel.NOTHING })
	}

	createPublisher<Event extends Events[keyof Events]>(topicName: Event['topic'], options: Partial<PublishOptions> = {}) {
		const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)
		const publish = async (data: Event['data']) => {
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
		}

		return { publish }
	}

	createSubscriber<Event extends Events[keyof Events]>(
		topicName: Event['topic'],
		onMessage: (data: Event['data']) => Promise<void>,
		options: Partial<SubscribeOptions> = {},
	) {
		options = { ...DefaultSubscribeOptions, ...options }
		let started = false
		const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)
		const subscribe = async () => {
			if (started) return
			started = true
			await this.#createTopic(topic)
			const groupId = options.fanout
				? Instance.get().getScopedName(`${Instance.get().settings.app.id}-fanout-${Random.string(10)}`)
				: topic
			const consumer = this.#client.consumer(this.#confluent ? ({ kafkaJS: { groupId } } as any) : { groupId })

			await consumer.connect()
			await consumer.subscribe({ topic })

			await consumer.run({
				eachMessage: async ({ message }) => {
					addWaitBeforeExit(
						(async () => {
							if (!message.value) return
							await onMessage(parseJSONValue(message.value.toString()))
						})(),
					)
				},
			})

			if (options.fanout)
				addWaitBeforeExit(async () => {
					await consumer.disconnect()
					await this.#deleteGroup(groupId)
				})
		}
		this._subscribers.push(subscribe)

		return { subscribe }
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
		await admin.createTopics({ topics: [{ topic }] })
	}

	async #deleteGroup(groupId: string) {
		const admin = await this.#getAdmin()
		await admin.deleteGroups([groupId]).catch(() => {})
	}
}
