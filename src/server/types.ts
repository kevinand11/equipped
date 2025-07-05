import { IsInTypeList, Pipe, PipeInput, PipeOutput, Prettify } from 'valleyed'

import type { Request, Response } from './requests'
import type { RequestError } from '../errors'
import { Enum } from '../types'

export const Methods = {
	head: 'head',
	get: 'get',
	post: 'post',
	put: 'put',
	patch: 'patch',
	delete: 'delete',
	options: 'options',
} as const

export const StatusCodes = {
	Ok: 200,
	Found: 302,
	BadRequest: 400,
	NotAuthenticated: 401,
	NotAuthorized: 403,
	NotFound: 404,
	ValidationError: 422,
	TooManyRequests: 429,
	AuthorizationExpired: 461,
} as const

export type MethodsEnum = Enum<typeof Methods>
export type StatusCodesEnum = Enum<typeof StatusCodes>

export type DefaultHeaders = Record<string, ArrayOrValue<string>>

type ArrayOrValue<T> = T | T[] | undefined

export type IncomingFile = {
	name: string
	type: string
	size: number
	isTruncated: boolean
	data: Buffer
	duration: number
}

export type RouteDef = {
	params?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>>
	query?: Pipe<Record<string, ArrayOrValue<unknown>>, Record<string, ArrayOrValue<unknown>>>
	headers?: Pipe<DefaultHeaders, DefaultHeaders>
	body?: Pipe<Record<string, unknown>, Record<string, unknown>>
	response?: Pipe<unknown, unknown>
	responseHeaders?: Pipe<DefaultHeaders, DefaultHeaders>
	defaultStatusCode?: StatusCodesEnum
	defaultContentType?: string
	context?: (req: Request<RouteDefToReqRes<RouteDef>>) => Awaitable<Record<string, unknown>>
}

type RouteGroup = { name: string; description?: string }
type HandlerSetup<T extends RouteDef> = (route: Route<T>) => void

export type RouteConfig<T extends RouteDef> = {
	middlewares?: ReturnType<typeof makeMiddleware<RouteDef>>[]
	onError?: ReturnType<typeof makeErrorMiddleware<RouteDef>>
	groups?: (RouteGroup | RouteGroup['name'])[]
	title?: string
	descriptions?: string[]
	security?: Record<string, string[]>[]
	schema?: T
	hide?: boolean
}

export type RouterConfig<T extends RouteDef> = RouteConfig<T> & { path: string }
export type Route<T extends RouteDef> = RouteConfig<T> & {
	path: string
	method: MethodsEnum
	handler: RouteDefHandler<T>
}

type GetApiPart<T extends RouteDef, K extends keyof RouteDef> = NonNullable<IsInTypeList<T[K], [unknown]> extends true ? RouteDef[K] : T[K]>

type ArePipes<A, B> = A extends Pipe<any, any> ? (B extends Pipe<any, any> ? true : false) : false
type Compare<K extends keyof RouteDef, A, B> =
	IsInTypeList<B, [unknown]> extends true
		? A
		: IsInTypeList<A, [unknown]> extends true
			? B
			: K extends `default${string}` | 'context'
				? B
				: ArePipes<A, B> extends true
					? Pipe<PipeInput<A> & PipeInput<B>, PipeOutput<A> & PipeOutput<B>>
					: B

export type MergeRouteDefs<A extends RouteDef, B extends RouteDef> = {
	[K in keyof RouteDef]: Compare<K, A[K], B[K]>
}

export type RouteDefToReqRes<T extends RouteDef> = Prettify<{
	body: PipeOutput<GetApiPart<T, 'body'>>
	params: PipeOutput<GetApiPart<T, 'params'>>
	requestHeaders: PipeOutput<GetApiPart<T, 'headers'>>
	query: PipeOutput<GetApiPart<T, 'query'>>
	response: PipeOutput<GetApiPart<T, 'response'>>
	responseHeaders: PipeOutput<GetApiPart<T, 'responseHeaders'>>
	statusCode: GetApiPart<T, 'defaultStatusCode'>
	contentType: GetApiPart<T, 'defaultContentType'>
	context: Awaited<ReturnType<GetApiPart<T, 'context'>>>
}>

type Awaitable<T> = Promise<T> | T
type Res<T extends RouteDefToReqRes<any>> = Awaitable<
	IsInTypeList<T['statusCode'], [StatusCodesEnum, 200]> extends true
		? IsInTypeList<T['responseHeaders'], [DefaultHeaders]> extends true
			? Response<T> | T['response']
			: Response<T>
		: Response<T>
>
export type RouteDefHandler<Def extends RouteDef> = (req: Request<RouteDefToReqRes<Def>>) => Res<RouteDefToReqRes<Def>>
type RouteMiddlewareHandler<_Def extends RouteDef> = (req: Request<RouteDefToReqRes<RouteDef>>) => Awaitable<void>
type ErrorHandler<Def extends RouteDef> = (
	req: Request<RouteDefToReqRes<Def>>,
	err: Error,
) => Res<
	Omit<RouteDefToReqRes<Def>, 'response' | 'statusCode' | 'responseHeaders'> & {
		response: RequestError['serializedErrors']
		statusCode: RequestError['statusCode']
		responseHeaders: DefaultHeaders
	}
>

function makeMiddlewareHandler<Cb extends Function, T extends RouteDef>(cb: Cb, onSetup?: HandlerSetup<T>) {
	return { cb, onSetup }
}

export const makeMiddleware = <Def extends RouteDef>(...args: Parameters<typeof makeMiddlewareHandler<RouteMiddlewareHandler<Def>, Def>>) =>
	makeMiddlewareHandler(...args)
export const makeErrorMiddleware = <Def extends RouteDef>(...args: Parameters<typeof makeMiddlewareHandler<ErrorHandler<Def>, Def>>) =>
	makeMiddlewareHandler(...args)
