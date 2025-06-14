import { PipeOutput, v } from 'valleyed'

export const kafkaConfigPipe = v.object({
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
	clientId: v.string(),
})

export type KafkaConfig = PipeOutput<typeof kafkaConfigPipe>

export const redisConfigPipe = v
	.object({
		host: v.string(),
		port: v.optional(v.number()),
		password: v.optional(v.string()),
		username: v.optional(v.string()),
		tls: v.optional(v.boolean()),
		cluster: v.optional(v.boolean()),
	})
	.meta({ title: 'Redis Config', $refId: 'RedisConfig' })

export type RedisConfig = PipeOutput<typeof redisConfigPipe>

export const rabbitmqConfigPipe = v
	.object({
		uri: v.string(),
		eventColumnName: v.string(),
	})
	.meta({ title: 'Rabbitmq Config', $refId: 'RabbitmqConfig' })

export type RabbitMQConfig = PipeOutput<typeof rabbitmqConfigPipe>

export const mongoDbConfigPipe = v
	.object({
		uri: v.string(),
	})
	.meta({ title: 'Mongodb Config', $refId: 'MongodbConfig' })

export type MongoDbConfig = PipeOutput<typeof mongoDbConfigPipe>

export const redisJobsConfigPipe = v
	.object({
		redisConfig: redisConfigPipe,
		queueName: v.string(),
	})
	.meta({ title: 'Redis Jobs Config', $refId: 'RedisJobsConfig' })

export type RedisJobConfig = PipeOutput<typeof redisJobsConfigPipe>
