import amqp from 'amqplib'
import { addWaitBeforeExit } from '../exit'
import { Instance } from '../instance'

export const pubAndSub = async () => {
	const column = Instance.get().settings.rabbitColumnName
	const con = await amqp.connect(Instance.get().settings.rabbitURI)

	con.on('error', (err) => {
		Instance.get().logger.error('Amqp error:', err.message)
		process.exit(1)
	})

	const channel = await con.createChannel()

	addWaitBeforeExit(channel.close)

	await channel.assertExchange(column, 'direct', { durable: true })
	await channel.prefetch(1)

	const publish = async (topic: string, data: any) => {
		channel.publish(column, topic, Buffer.from(data), { persistent: true })
	}

	const subscribe = async (topic: string, cb: (data: string, topic: string) => void) => {
		const queue = `${Instance.get().settings.appId}-${topic}`
		await channel.assertQueue(queue, { durable: true })
		await channel.bindQueue(queue, column, topic)
		channel.consume(queue, (msg) => {
			if (msg) {
				try {
					cb(msg.content.toString(), msg.fields.routingKey)
					channel.ack(msg)
				} catch (err) {
					channel.nack(msg)
				}
			}
		}, {
			noAck: false
		}).then()
	}

	return { publish, subscribe }
}
