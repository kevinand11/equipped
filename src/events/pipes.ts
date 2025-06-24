import { PipeOutput, v } from 'valleyed'

export const rabbitmqConfigPipe = v.meta(
	v.object({
		uri: v.string(),
		eventColumnName: v.string(),
	}),
	{ title: 'Rabbitmq Config', $refId: 'RabbitmqConfig' },
)

export const kafkaConfigPipe = v.meta(
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
		confluent: v.optional(v.boolean()),
		clientId: v.optional(v.string()),
	}),
	{ title: 'Kafka Config', $refId: 'KafkaConfig' },
)

export type KafkaConfig = PipeOutput<typeof kafkaConfigPipe>
export type RabbitMQConfig = PipeOutput<typeof rabbitmqConfigPipe>
