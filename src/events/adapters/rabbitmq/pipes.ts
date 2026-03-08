import { type PipeInput, v } from 'valleyed'

export const rabbitmqConfigPipe = () =>
	v.meta(
		v.object({
			uri: v.string(),
			eventColumnName: v.string(),
		}),
		{ title: 'Rabbitmq Config', $refId: 'RabbitmqConfig' },
	)

export type RabbitMQConfig = PipeInput<ReturnType<typeof rabbitmqConfigPipe>>
