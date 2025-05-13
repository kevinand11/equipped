import Confluent from '@confluentinc/kafka-javascript'
import Kafka from 'kafkajs'

import type { Events, SubscribeOptions } from '.'
import { DefaultSubscribeOptions, EventBus } from '.'
import { addWaitBeforeExit } from '../exit'
import { Instance } from '../instance'
import { parseJSONValue } from '../utils/json'
import { Random } from '../utils/utils'

export class KafkaEventBus extends EventBus {
	#client: Kafka.Kafka | Confluent.KafkaJS.Kafka
	#confluent: boolean
	constructor () {
		super()
		const settings = Instance.get().settings
		const { confluent = false, ...kafkaSettings } = settings.kafka
		this.#confluent = confluent
		this.#client = confluent ? new Confluent.KafkaJS.Kafka({
			kafkaJS: {
				clientId: settings.eventColumnName,
				logLevel: Confluent.KafkaJS.logLevel.NOTHING,
				...kafkaSettings,
			}
		}) :
			new Kafka.Kafka({
			clientId: settings.eventColumnName,
			logLevel: Kafka.logLevel.NOTHING,
			...kafkaSettings,
			})
	}

	createPublisher<Event extends Events[keyof Events]>(topic: Event['topic']) {
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
		topic: Event['topic'],
		onMessage: (data: Event['data']) => Promise<void>,
		options: Partial<SubscribeOptions> = {},
	) {
		options = { ...DefaultSubscribeOptions, ...options }
		let started = false
		const subscribe = async () => {
			if (started) return
			started = true
			await this.#createTopic(topic)
			const groupId = options.fanout
				? `${Instance.get().settings.appId}-fanout-${Random.string(10)}`
				: `${Instance.get().settings.appId}-${topic}`
			const consumer = this.#client.consumer(this.#confluent ? { kafkaJS: { groupId } } as any : { groupId })

			await consumer.connect()
			await consumer.subscribe({ topic })

			await consumer.run({
				eachMessage: async ({ message }) => {
					addWaitBeforeExit(
						(async () => {
							if (!message.value) return
							await onMessage(parseJSONValue(message.value.toString())).catch(() => {})
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

	async #createTopic(topic: string) {
		const admin = this.#client.admin()
		await admin.connect()
		await admin.createTopics({ topics: [{ topic }] })
	}

	async #deleteGroup(groupId: string) {
		const admin = this.#client.admin()
		await admin.deleteGroups([groupId]).catch(() => {})
	}
}
