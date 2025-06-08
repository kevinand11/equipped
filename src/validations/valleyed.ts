import { PipeError, makePipe, v } from 'valleyed'

import { Instance } from '../instance'
import type { IncomingFile } from '../server'

export * from 'valleyed/lib/api/externals'

const filePipe = (err?: string) =>
	v.array(
		v.file<IncomingFile>(err).pipe((input) => {
			const err = `is larger than allowed limit of ${Instance.get().settings.requests.maxFileUploadSizeInMb}mb`
			const valid = input ? !input.isTruncated : true
			if (valid) return input
			throw PipeError.root(err, input)
		}),
	)

export const incomingFile = (err?: string) =>
	makePipe<IncomingFile>(
		(input) =>
			filePipe(err)
				.pipe(v.containsMin(1, 'no file provided'))
				.pipe((files) => files[0])
				.parse(input),
		{ type: 'string', format: 'binary' },
	)

export const incomingFiles = (err?: string) =>
	makePipe<IncomingFile[]>((input) => filePipe(err).parse(input), { type: 'string', format: 'binary' })
