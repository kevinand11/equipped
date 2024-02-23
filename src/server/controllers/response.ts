import { StatusCodes, SupportedStatusCodes } from '../statusCodes'

export class Response<T> {
	readonly body: T | undefined
	readonly status: SupportedStatusCodes
	readonly headers: Record<string, any>
	readonly piped: boolean

	constructor ({
		body,
		status = StatusCodes.Ok,
		headers = { 'Content-Type': 'application/json' },
		piped = false
	}: {
		body?: T,
		status?: SupportedStatusCodes,
		headers?: Record<string, any>
		piped?: boolean
	}) {
		this.body = body
		this.status = status
		this.headers = headers
		this.piped = piped
	}

	get shouldJSONify () {
		return this.body === null || this.body === undefined
	}
}
