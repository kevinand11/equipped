import type { Readable } from 'node:stream'

import type { SerializeOptions } from '@fastify/cookie'
import type { DistributiveOmit, IsInTypeList } from 'valleyed'

import type { RequestError } from '../errors'
import type { DefaultCookies, DefaultHeaders, IncomingFile, MethodsEnum, RouteDef, RouteDefToReqRes } from './types'
import type { AuthUser, RefreshUser } from '../types'
import { parseJSONObject } from '../utilities'

type HeaderKeys = 'Authorization' | 'RefreshToken' | 'ApiKey' | 'Referer' | 'ContentType' | 'UserAgent'
type ReqUser<T> = { error?: RequestError; value?: T }
type FallbackHeadersType = Record<string, string | string[] | undefined>

type CookieVal<C extends DefaultCookies> = {
	[K in keyof C]: SerializeOptions & { value: C[K] }
}

export class Request<Def extends RouteDefToReqRes<any>> {
	readonly ip: string | undefined
	readonly method: MethodsEnum
	readonly path: string
	body: Def['body']
	params: Def['params']
	query: Def['query']
	headers: Record<HeaderKeys, string | undefined> & Def['requestHeaders'] & FallbackHeadersType
	cookies: Record<string, string | undefined> & Def['requestCookies']
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
		cookies: Record<string, string | undefined> & Def['requestCookies']
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

	pipe(stream: Readable, opts: { headers?: Def['responseHeaders']; cookies?: Def['responseCookies']; status?: Def['statusCode'] } = {}) {
		return new Response<Omit<Def, 'response'> & { response: Readable }>(<any>{ ...opts, piped: true, body: stream })
	}

	res(params: DistributiveOmit<RequestParams<Def>, 'piped'>) {
		return new Response<Def>(<any>{ ...params, piped: false })
	}

	error<
		T extends Omit<Def, 'response' | 'statusCode' | 'responseHeaders' | 'responseCookies' | 'contentType'> & {
			response: RequestError['serializedErrors']
			statusCode: RequestError['statusCode']
			responseHeaders: DefaultHeaders
			responseCookies: DefaultCookies
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
		: { headers: Def['responseHeaders'] }) &
	(IsInTypeList<Def['responseCookies'], [DefaultCookies]> extends true
		? { cookies?: CookieVal<Def['responseCookies']> }
		: { cookies: CookieVal<Def['responseCookies']> })

export class Response<Def extends RouteDefToReqRes<any>> {
	body: Def['response'] | undefined
	headers: Def['responseHeaders']
	cookies: CookieVal<Def['responseCookies']>
	readonly status: Def['statusCode']
	readonly contentType: Def['contentType']
	readonly piped: boolean

	constructor({
		body,
		status = <any>200,
		headers = <any>{},
		cookies = <any>{},
		piped = false,
		contentType = <any>'application/json',
	}: RequestParams<Def>) {
		this.body = body
		this.status = status
		this.contentType = contentType
		this.headers = headers
		this.cookies = cookies
		this.piped = piped

		if (!this.piped) {
			// @ts-expect-error indexing on generic
			this.headers['Content-Type'] = contentType
		}
	}

	get cookieValues() {
		return Object.fromEntries(Object.entries(this.cookies).map(([key, val]) => [key, val] as const))
	}

	set cookieValues(values: DefaultCookies) {
		Object.entries(values).forEach(([key, val]) => {
			// @ts-expect-error indexing on generic
			if (this.cookies[key]) this.cookies[key].value = val
		})
	}
}
