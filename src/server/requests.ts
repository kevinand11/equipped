import { Writable } from 'stream'
import { CustomError } from '../errors'
import { StorageFile } from '../storage'
import { Defined } from '../types'
import { AuthUser, RefreshUser } from '../utils/authUser'
import { parseJSONValue } from '../utils/json'
import { Api, FileSchema, StatusCodes, SupportedStatusCodes } from './types'

type HeaderKeys = 'AccessToken' | 'RefreshToken' | 'Referer' | 'ContentType' | 'UserAgent'

type IsFileOrFileArray<T> = T extends FileSchema ? T : T extends FileSchema[] ? T : never
type ApiToFiles<Def extends Api> = {
	[K in keyof Def['body'] as IsFileOrFileArray<Def['body'][K]> extends never ? never : K]: StorageFile[]
}

export class Request<Def extends Api = Api> {
	readonly ip: string | undefined
	readonly method: Def['method']
	readonly path: string
	readonly body: Def['body']
	readonly params: Defined<Def['params']>
	readonly query: Defined<Def['query']>
	readonly cookies: Record<string, any>
	readonly rawBody: unknown
	readonly headers: Record<HeaderKeys, string | null> & Record<string, string | string[] | null>
	readonly files: ApiToFiles<Def>
	authUser: null | AuthUser = null
	refreshUser: null | RefreshUser = null
	pendingError: null | CustomError = null

	constructor ({
		ip, body, cookies, params, query,
		method, path, headers, files
	}: {
		ip: string | undefined
		body: unknown
		params: Def['params']
		query: Def['query']
		cookies: Record<string, any>
		headers: Record<HeaderKeys, string | null> & Record<string, string | string[] | null>
		files: ApiToFiles<Def>
		method: Def['method']
		path: string,
	}, private readonly response: Writable) {
		this.ip = ip
		this.method = method
		this.path = path
		this.rawBody = body
		this.body =  Object.fromEntries(
			Object.entries(body && typeof body === 'object' ? body : { raw: body })
				.map(([key, value]) => [key, parseJSONValue(value)])
		) as any
		this.cookies = cookies
		this.params = params as any
		this.query = Object.fromEntries(
			Object.entries(query && typeof body === 'object' ? query : {})
				.map(([key, val]) => [key, this.#parseQueryStrings(val)])
		) as any
		if (this.query?.['auth']) delete this.query['auth']
		if (this.query?.['authType']) delete this.query['authType']
		this.headers = headers
		this.files = files
	}

	#parseQueryStrings (value: unknown) {
		if (Array.isArray(value)) return value.map(this.#parseQueryStrings)
		if (typeof value === 'string') return parseJSONValue(value)
		return value
	}

	pipe (cb: (stream: Writable) => void) {
		cb(this.response)
		return new Response({ piped: true, status: StatusCodes.Ok, body: this.response })
	}
}

export class Response<T, S extends SupportedStatusCodes = SupportedStatusCodes> {
	readonly body: T | undefined
	readonly status: S
	readonly headers: Record<string, any>
	readonly piped: boolean

	constructor ({
		body,
		status = StatusCodes.Ok as any,
		headers = { 'Content-Type': 'application/json' },
		piped = false
	}: {
		body?: T,
		status?: S,
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
