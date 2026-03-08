import { type PipeOutput, v } from 'valleyed'

export const mongoDbConfigPipe = () =>
	v.meta(
		v.object({
			uri: v.string(),
		}),
		{ title: 'Mongodb Config', $refId: 'MongodbConfig' },
	)

export type MongoDbConfig = PipeOutput<ReturnType<typeof mongoDbConfigPipe>>
