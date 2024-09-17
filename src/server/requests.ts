import { Writable } from 'stream'
import { CustomError } from '../errors'
import { StorageFile } from '../storage'
import { Defined, DistributiveOmit, ExcludeUnknown, IsInTypeList } from '../types'
import { AuthUser, RefreshUser } from '../utils/authUser'
import { parseJSONValue } from '../utils/json'
import { Api, FileSchema, HeadersType, SupportedStatusCodes } from './types'

type HeaderKeys = 'AccessToken' | 'RefreshToken' | 'Referer' | 'ContentType' | 'UserAgent'

type IsFileOrFileArray<T> = T extends FileSchema ? StorageFile[] : T extends FileSchema[] ? StorageFile[] : T
type ApiToBody<Def extends Api> = MappedUnion<Def['body']>
type UnionMapper<T> = {
    [K in T extends infer P ? keyof P : never]: T extends infer P
        ? K extends keyof P
    ? {
        [Q in keyof T]: IsFileOrFileArray<T[Q]>
	}
	: never
: never
}
type MappedUnion<T> = UnionMapper<T>[keyof UnionMapper<T>]

export class Request<Def extends Api = Api> {
	readonly ip: string | undefined
	readonly method: Def['method']
	readonly path: string
	readonly body: ApiToBody<Def>
	readonly params: ExcludeUnknown<Def['params'], Record<string, string>>
	readonly query: ExcludeUnknown<Def['query'], Record<string, any>>
	readonly cookies: Record<string, any>
	readonly rawBody: unknown
	readonly headers: Record<HeaderKeys, string | undefined> & ExcludeUnknown<Def['requestHeaders'], {}> & HeadersType
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
		headers: Record<HeaderKeys, string | undefined> & ExcludeUnknown<Def['requestHeaders'], {}> & HeadersType
		files: Record<string, StorageFile[]>
		method: Def['method']
		path: string,
	}, private readonly response: Writable) {
		this.ip = ip
		this.method = method
		this.path = path
		this.rawBody = body
		this.body = <any>Object.assign(Object.fromEntries(
			Object.entries(body && typeof body === 'object' ? body : { raw: body })
				.map(([key, value]) => [key, parseJSONValue(value)])
		), files)
		this.cookies = cookies
		this.params = <any>params
		this.query = <any>Object.fromEntries(
			Object.entries(query && typeof body === 'object' ? query : {})
				.map(([key, val]) => [key, this.#parseQueryStrings(val)])
		)
		if (this.query?.['auth']) delete this.query['auth']
		if (this.query?.['authType']) delete this.query['authType']
		this.headers = headers
	}

	#parseQueryStrings (value: unknown) {
		if (Array.isArray(value)) return value.map(this.#parseQueryStrings)
		if (typeof value === 'string') return parseJSONValue(value)
		return value
	}

	pipe (cb: (stream: Writable) => void) {
		cb(this.response)
		return new Response({ piped: true, body: this.response })
	}

	res (params: DistributiveOmit<RequestParams<Def['response'], ExcludeUnknown<Defined<Def['defaultStatusCode']>, SupportedStatusCodes>, ExcludeUnknown<Defined<Def['responseHeaders']>, HeadersType>>, 'piped'>) {
		return new Response<
			Def['response'],
			ExcludeUnknown<Defined<Def['defaultStatusCode']>, SupportedStatusCodes>,
			ExcludeUnknown<Defined<Def['responseHeaders']>, HeadersType>
		>(<any>{ ...params, piped: false })
	}

	error (params: DistributiveOmit<RequestParams<CustomError['serializedErrors'], CustomError['statusCode'], HeadersType>, 'piped'>) {
		return new Response<
			CustomError['serializedErrors'],
			CustomError['statusCode'],
			HeadersType
		>(<any>{ ...params, piped: false })
	}
}

type RequestParams<T, S extends SupportedStatusCodes, H extends HeadersType> =
	{ body: T, piped?: boolean } &
	(IsInTypeList<S, [SupportedStatusCodes, 200]> extends true ? { status?: S } : { status: S }) &
	(IsInTypeList<H, [HeadersType]> extends true ? { headers?: H } : { headers: H })

export class Response<T, S extends SupportedStatusCodes, H extends HeadersType> {
	readonly body: T | undefined
	readonly status: S
	readonly headers: H
	readonly piped: boolean

	constructor ({
		body,
		status = <S>200,
		headers = <H>{},
		piped = false
	}: RequestParams<T, S, H>) {
		this.body = body
		this.status = status
		this.headers = headers
		this.piped = piped

		const contentType = Object.keys(this.headers).find((key) => key.toLowerCase() === 'content-type')
		// @ts-expect-error generic headers
		if (!contentType) this.headers['Content-Type'] = 'application/json'
	}

	get shouldJSONify () {
		return this.body === null || this.body === undefined
	}
}
