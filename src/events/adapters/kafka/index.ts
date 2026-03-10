import { KafkaJS } from '@confluentinc/kafka-javascript'
import { v } from 'valleyed'

import { EquippedError } from '../../../errors'
import { Instance } from '../../../instance'
import { Random, configurable, parseJSONValue } from '../../../utilities'
import { type EventBus } from '../base'

export const kafkaConfigPipe = () =>
	v.meta(
		v.object({
			brokers: v.array(v.string()),
			ssl: v.optional(v.boolean()),
			sasl: v.optional(
				v.object({
					mechanism: v.is('plain' as const),
					username: v.string(),
					password: v.string(),
				}),
			),
			clientId: v.optional(v.string()),
		}),
		{ title: 'Kafka Config', $refId: 'KafkaConfig' },
	)

export const KafkaEventBus = configurable(kafkaConfigPipe, (config): EventBus => {
	const client = new KafkaJS.Kafka({
		kafkaJS: { ...config, logLevel: KafkaJS.logLevel.NOTHING },
	})

	let admin: Promise<KafkaJS.Admin> | null = null
	const getAdmin = () => {
		if (!admin)
			admin = (async () => {
				const admin = client.admin()
				await admin.connect()
				return admin
			})()
		return admin
	}

	const createTopic = async (topic: string) => {
		const admin = await getAdmin()
		await admin.createTopics({ topics: [{ topic }], timeout: 5000 })
	}

	const deleteGroup = async (groupId: string) => {
		const admin = await getAdmin()
		await admin.deleteGroups([groupId]).catch(() => {})
	}

	const eventBus: EventBus = {
		stream: (topicName, options = {}) => {
			const topic = options.skipScope ? topicName : Instance.get().getScopedName(topicName)
			return {
				publish: async (data) => {
					const producer = client.producer()
					await producer.connect()
					await producer.send({
						topic,
						messages: [{ value: JSON.stringify(data) }],
					})
					return true
				},
				subscribe: (onMessage) => {
					const subscribe = async () => {
						await createTopic(topic)
						const groupId = options.fanout
							? Instance.get().getScopedName(`${Instance.get().id}-fanout-${Random.string(10)}`)
							: topic
						const consumer = client.consumer({ kafkaJS: { groupId } })

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
									await deleteGroup(groupId)
								},
								10,
							)
					}
					Instance.on('start', subscribe, 2)
				},
			}
		},
	}

	return eventBus
})
