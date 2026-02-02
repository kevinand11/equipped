import type { IncomingHttpHeaders } from 'node:http2'

import { BaseRequestAuthMethod } from './base'
import { NotAuthenticatedError } from '../../errors'

export abstract class BaseApiKeyRequestAuthMethod<T extends { id: string }> extends BaseRequestAuthMethod<T> {
	protected readonly headerName: string
	protected abstract verify(apiKey: string): Promise<T>

	constructor(headerName: string) {
		super()
		this.headerName = headerName
	}

	async parse(headers: IncomingHttpHeaders) {
		const headerValue = headers[this.headerName]
		if (!headerValue || typeof headerValue !== 'string') throw new NotAuthenticatedError()
		return this.verify(headerValue)
	}

	routeSecuritySchemeName() {
		return this.headerName
	}
}
