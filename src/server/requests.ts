import { Writable } from 'stream'
import { CustomError } from '../errors'
import { StorageFile } from '../storage'
import { AuthUser, RefreshUser } from '../utils/authUser'
import { parseJSONValue } from '../utils/json'
import { StatusCodes, SupportedStatusCodes } from './types'

type HeaderKeys = 'AccessToken' | 'RefreshToken' | 'Referer' | 'ContentType' | 'UserAgent'

export class Request {
	readonly ip: string | undefined
	readonly method: string
	readonly path: string
	readonly body: Record<string, any>
	readonly cookies: Record<string, any>
	readonly rawBody: Record<string, any>
	readonly params: Record<string, string>
	readonly query: Record<string, any>
	readonly headers: Record<HeaderKeys, string | null> & Record<string, string | string[] | null>
	readonly files: Record<string, StorageFile[]>
	authUser: null | AuthUser = null
	refreshUser: null | RefreshUser = null
	pendingError: null | CustomError = null

	constructor ({
		ip, body, cookies, params, query,
		method, path, headers, files, data
	}: {
		ip: string | undefined
		body: Record<string, any>
		cookies: Record<string, any>
		params: Record<string, any>
		query: Record<string, any>
		headers: Record<HeaderKeys, string | null> & Record<string, string | string[] | null>
		files: Record<string, StorageFile[]>
		method: string
		path: string,
		data: Record<string, any>
	}, private readonly response: Writable) {
		this.ip = ip
		this.method = method
		this.path = path
		this.rawBody = body
		this.body =  Object.fromEntries(
			Object.entries(typeof body === 'object' ? body : { raw: body })
				.map(([key, value]) => [key, parseJSONValue(value)])
		)
		this.cookies = cookies
		this.params = params
		this.query = Object.fromEntries(
			Object.entries(query ?? {})
				.map(([key, val]) => [key, this.#parseQueryStrings(val)])
		)
		if (this.query['auth']) delete this.query['auth']
		if (this.query['authType']) delete this.query['authType']
		this.headers = headers
		this.files = files
		this.authUser = data.authUser ?? null
		this.refreshUser = data.refreshUser ?? null
	}

	#parseQueryStrings (value: string | string[]) {
		if (Array.isArray(value)) return value.map(this.#parseQueryStrings)
		return parseJSONValue(value)
	}

	pipe (cb: (stream: Writable) => void) {
		cb(this.response)
		return new Response({ piped: true, status: StatusCodes.Ok, body: this.response })
	}
}

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
