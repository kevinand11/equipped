import { PipeError, v } from 'valleyed'

import { Instance } from '../instance'
import type { IncomingFile } from '../schemas'

export * from 'valleyed/lib/api/externals'

export const file = (err?: string) =>
	v.file(err).pipe((input: IncomingFile) => {
		err = err ?? `is larger than allowed limit of ${Instance.get().settings.requests.maxFileUploadSizeInMb}mb`
		const valid = input ? !input.isTruncated : true
		if (valid) return input
		throw new PipeError([err], input)
	})

declare module 'valleyed/lib/api/files' {
	interface File extends IncomingFile {}
}
