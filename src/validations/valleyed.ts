import { PipeError, v } from 'valleyed'

import { Instance } from '../instance'
import type { IncomingFile } from '../server'

export * from 'valleyed/lib/api/externals'

const filePipe = (err?: string) =>
	v.array(
		v.file<IncomingFile>(err).pipe((input) => {
			const err = `is larger than allowed limit of ${Instance.get().settings.server?.requests.maxFileUploadSizeInMb}mb`
			const valid = input ? !input.isTruncated : true
			if (valid) return input
			throw PipeError.root(err, input)
		}),
	)

export const incomingFile = (err?: string) =>
	v.pipe<unknown, IncomingFile, any>(
		(input) =>
			filePipe(err)
				.pipe(v.min(1, 'no file provided'))
				.pipe((files) => files[0])
				.parse(input),
		{ schema: () => ({ type: 'string', format: 'binary' }) },
	)

export const incomingFiles = (err?: string) =>
	v.pipe<unknown, IncomingFile[], any>((input) => filePipe(err).parse(input), { schema: () => ({ type: 'string', format: 'binary' }) })
