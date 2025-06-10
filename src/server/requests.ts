import type { Readable } from 'stream'

import type { RequestError } from '../errors'
import type { DefaultHeaders, IncomingFile, MethodsEnum, RouteDef, RouteDefToReqRes } from './types'
import type { DistributiveOmit, IsInTypeList } from '../types'
import type { AuthUser, RefreshUser } from '../types/overrides'
import { parseJSONObject } from '../utils/json'

type HeaderKeys = 'Authorization' | 'RefreshToken' | 'ApiKey' | 'Referer' | 'ContentType' | 'UserAgent'
type ReqUser<T> = { error?: RequestError; value?: T }
type FallbackHeadersType = Record<string, string | string[] | undefined>

export class Request<Def extends RouteDefToReqRes<any>> {
	readonly ip: string | undefined
	readonly method: MethodsEnum
	readonly path: string
	body: Def['body']
	params: Def['params']
	query: Def['query']
	headers: Record<HeaderKeys, string | undefined> & Def['requestHeaders'] & FallbackHeadersType
	readonly cookies: Record<string, any>
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
		body: Def['body']
		params: Def['params']
		query: Def['query']
		cookies: Record<string, any>
		headers: Record<HeaderKeys, string | undefined> & Def['requestHeaders'] & FallbackHeadersType
		files: Record<string, IncomingFile[]>
		method: MethodsEnum
		path: string
	}) {
		this.ip = ip
		this.method = method
		this.path = path
		this.params = params
		this.cookies = cookies
		this.headers = headers
		this.query = parseJSONObject(query)
		this.body = <any>Object.assign(parseJSONObject(body), files)
	}

	pipe(stream: Readable, opts: { headers?: Def['responseHeaders']; status?: Def['statusCode'] } = {}) {
		return new Response<Omit<Def, 'response'> & { response: Readable }>(<any>{ ...opts, piped: true, body: stream })
	}

	res(params: DistributiveOmit<RequestParams<Def>, 'piped'>) {
		return new Response<Def>(<any>{ ...params, piped: false })
	}

	error<
		T extends Omit<Def, 'response' | 'statusCode' | 'responseHeaders' | 'contentType'> & {
			response: RequestError['serializedErrors']
			statusCode: RequestError['statusCode']
			responseHeaders: DefaultHeaders
			contentType: 'application/json'
		},
	>(params: DistributiveOmit<RequestParams<T>, 'piped'>) {
		return new Response<T>(<any>{ ...params, piped: false })
	}
}

type RequestParams<Def extends RouteDefToReqRes<any>, T = Def['response']> = { body: T; piped?: boolean } & (IsInTypeList<
	Def['statusCode'],
	[NonNullable<RouteDef['defaultStatusCode']>, 200]
> extends true
	? { status?: Def['statusCode'] }
	: { status: Def['statusCode'] }) &
	(IsInTypeList<Def['contentType'], [NonNullable<RouteDef['defaultContentType']>, 'application/json']> extends true
		? { contentType?: Def['contentType'] }
		: { contentType: Def['contentType'] }) &
	(IsInTypeList<Def['responseHeaders'], [DefaultHeaders]> extends true
		? { headers?: Def['responseHeaders'] }
		: { headers: Def['responseHeaders'] })

export class Response<Def extends RouteDefToReqRes<any>> {
	body: Def['response'] | undefined
	headers: Def['responseHeaders']
	readonly status: Def['statusCode']
	readonly contentType: Def['contentType']
	readonly piped: boolean

	constructor({ body, status = <any>200, headers = <any>{}, piped = false, contentType = <any>'application/json' }: RequestParams<Def>) {
		this.body = body
		this.status = status
		this.contentType = contentType
		this.headers = headers
		this.piped = piped

		if (!this.piped) {
			// @ts-expect-error indexing on generic
			this.headers['Content-Type'] = contentType
		}
	}
}
