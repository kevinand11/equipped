import { PipeError, v } from 'valleyed'

import { Instance } from '../instance'
import type { IncomingFile } from '../server'

export * from 'valleyed/lib/api/externals'

export const incomingFile = (err?: string) =>
	v.file<IncomingFile>().pipe((input) => {
		err = err ?? `is larger than allowed limit of ${Instance.get().settings.requests.maxFileUploadSizeInMb}mb`
		const valid = input ? !input.isTruncated : true
		if (valid) return input
		throw PipeError.root(err, input)
	})
