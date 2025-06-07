import type { Readable } from 'stream'

import { File } from 'valleyed'

import type { RequestError } from '../errors'
import type { FileSchema, HeadersType, MethodsEnum, RouteDefToReqRes, StatusCodesEnum } from './types'
import type { DistributiveOmit, IsInTypeList, Prettify } from '../types'
import type { AuthUser, RefreshUser } from '../types/overrides'
import { parseJSONValue } from '../utils/json'

type HeaderKeys = 'Authorization' | 'RefreshToken' | 'ApiKey' | 'Referer' | 'ContentType' | 'UserAgent'

type IsFileOrFileArray<T> = T extends FileSchema | File ? IncomingFile[] : T extends FileSchema[] ? IncomingFile[] : T
type ApiToBody<T> = Prettify<MappedUnion<T>>
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

type ReqUser<T> = { error?: RequestError; value?: T }

export class Request<Def extends RouteDefToReqRes<any> = any> {
	readonly ip: string | undefined
	readonly method: MethodsEnum
	readonly path: string
	readonly body: ApiToBody<Def['body']>
	readonly params: Def['params']
	readonly query: Def['query']
	readonly cookies: Record<string, any>
	readonly rawBody: unknown
	readonly headers: Prettify<Record<HeaderKeys, string | undefined> & Def['requestHeaders'] & HeadersType>
	users: {
		access: ReqUser<AuthUser>
		refresh: ReqUser<RefreshUser>
		apiKey: ReqUser<AuthUser>
	} = {
		access: {},
		refresh: {},
		apiKey: {},
	}
	authUser?: AuthUser

	constructor({
		ip,
		body,
		cookies,
		params,
		query,
		method,
		path,
		headers,
		files,
	}: {
		ip: string | undefined
		body: unknown
		params: Def['params']
		query: Def['query']
		cookies: Record<string, any>
		headers: Record<HeaderKeys, string | undefined> & Def['requestHeaders'] & HeadersType
		files: Record<string, IncomingFile[]>
		method: MethodsEnum
		path: string
	}) {
		this.ip = ip
		this.method = method
		this.path = path
		this.rawBody = body
		this.body = <any>(
			Object.assign(
				Object.fromEntries(
					Object.entries(body && typeof body === 'object' ? body : { raw: body }).map(([key, value]) => [
						key,
						parseJSONValue(value),
					]),
				),
				files,
			)
		)
		this.cookies = cookies
		this.params = <any>params
		this.query = <any>(
			Object.fromEntries(
				Object.entries(query && typeof body === 'object' ? query : {}).map(([key, val]) => [key, this.#parseQueryStrings(val)]),
			)
		)
		if (this.query?.['auth']) delete this.query['auth']
		if (this.query?.['authType']) delete this.query['authType']
		this.headers = <any>headers
	}

	#parseQueryStrings(value: unknown) {
		if (Array.isArray(value)) return value.map(this.#parseQueryStrings)
		if (typeof value === 'string') return parseJSONValue(value)
		return value
	}

	pipe(stream: Readable, opts: { headers?: Def['responseHeaders']; status?: Def['statusCode'] } = {}) {
		return new Response<Omit<Def, 'response'> & { response: Readable }>(<any>{ ...opts, piped: true, body: stream })
	}

	res(params: DistributiveOmit<RequestParams<Def>, 'piped'>) {
		return new Response<Def>(<any>{ ...params, piped: false })
	}

	error<
		T extends Omit<Def, 'response' | 'statusCode' | 'responseHeaders'> & {
			response: RequestError['serializedErrors']
			statusCode: RequestError['statusCode']
			responseHeaders: HeadersType
		},
	>(params: DistributiveOmit<RequestParams<T>, 'piped'>) {
		return new Response<T>(<any>{ ...params, piped: false })
	}
}

type RequestParams<Def extends RouteDefToReqRes<any>, T = Def['response']> = { body: T; piped?: boolean } & (IsInTypeList<
	Def['statusCode'],
	[StatusCodesEnum, 200]
> extends true
	? { status?: Def['statusCode'] }
	: { status: Def['statusCode'] }) &
	(IsInTypeList<Def['responseHeaders'], [HeadersType]> extends true
		? { headers?: Def['responseHeaders'] }
		: { headers: Def['responseHeaders'] })

export class Response<Def extends RouteDefToReqRes<any> = any> {
	readonly body: Def['response'] | undefined
	readonly status: Def['statusCode']
	readonly headers: Def['responseHeaders']
	readonly piped: boolean

	constructor({ body, status = <any>200, headers = <any>{}, piped = false }: RequestParams<Def>) {
		this.body = body
		this.status = status
		this.headers = headers
		this.piped = piped

		if (!this.piped) {
			const contentType = Object.keys(this.headers as any).find((key) => key.toLowerCase() === 'content-type')
			if (!contentType) this.headers['Content-Type'] = 'application/json'
		}
	}

	get shouldJSONify() {
		return this.body === null || this.body === undefined
	}
}

export interface IncomingFile {
	name: string
	type: string
	size: number
	isTruncated: boolean
	data: Buffer
	duration: number
}
