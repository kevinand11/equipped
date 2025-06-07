import { PipeOutput, v } from 'valleyed'

export function incomingFileSchema() {
	return v.object({
		name: v.string(),
		type: v.string(),
		size: v.number(),
		isTruncated: v.boolean(),
		data: v.any<Buffer>(), // Buffer is not directly supported, using any for binary data
		duration: v.number(),
	})
}

export type IncomingFile = PipeOutput<ReturnType<typeof incomingFileSchema>>
