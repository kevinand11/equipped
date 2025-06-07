import { IsInTypeList, Pipe, PipeInput, Prettify } from 'valleyed'

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

export type HeadersType = Record<string, string | string[] | undefined>
export type FileSchema = 'equipped-file-schema'
export type DateSchema = 'equipped-date-schema'

type ArrayOrValue<T> = T | T[]

type RouteGroup = { name: string; description?: string }
export type HandlerSetup = (route: Route) => void

export type RouteDef = Readonly<{
	body?: Pipe<any, any, any>
	params?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>, any>
	headers?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>, any>
	responseHeaders?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>, any>
	query?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>, any>
	response?: Pipe<any, any, any>
	defaultStatusCode?: StatusCodesEnum
	hide?: boolean
}>

export type RouteConfig = {
	onSetupHandler?: HandlerSetup
	middlewares?: ReturnType<typeof makeMiddleware>[]
	onError?: ReturnType<typeof makeErrorMiddleware>
	groups?: (RouteGroup | RouteGroup['name'])[]
	title?: string
	descriptions?: string[]
	security?: Record<string, string[]>[]
}

export type RouteDefConfig<T extends RouteDef> = RouteGeneralConfig & { schema?: T }
export type RouteGeneralConfig = RouteConfig & { path: string }

export type Route<T extends RouteDef = RouteDef> = RouteDefConfig<T> & {
	path: string
	method: MethodsEnum
	handler: RouteDefHandler<T>
}

type P<T, D = never, Np extends boolean = false> = Np extends true
	? Exclude<T, undefined> extends never
		? D
		: Exclude<T, undefined>
	: Exclude<T, undefined> extends Pipe<any, any, any>
		? PipeInput<Exclude<T, undefined>>
		: D
export type RouteDefToReqRes<T extends RouteDef> = Prettify<{
	body: P<T['body'], object>
	params: P<T['params']>
	requestHeaders: P<T['headers']>
	query: P<T['query']>
	response: P<T['response'], any>
	responseHeaders: P<T['responseHeaders']>
	statusCode: P<T['defaultStatusCode'], 200, true>
}>

type Awaitable<T> = Promise<T> | T
type Res<T extends RouteDefToReqRes<any>> = Awaitable<
	IsInTypeList<T['statusCode'], [StatusCodesEnum, 200, unknown]> extends true
		? IsInTypeList<T['responseHeaders'], [HeadersType, unknown]> extends true
			? Response<T> | T['response']
			: Response<T>
		: Response<T>
>
export type RouteDefHandler<Def extends RouteDef> = (req: Request<RouteDefToReqRes<Def>>) => Res<RouteDefToReqRes<Def>>
export type AddMethodDefImpls = {
	[Method in MethodsEnum]: <T extends RouteDef>(path: string, config?: RouteConfig) => (handler: RouteDefHandler<T>) => Route<T>
}

type RouteMiddlewareHandler<Def extends RouteDef> = (req: Request<RouteDefToReqRes<Def>>) => Awaitable<void>
type ErrorHandler<Def extends RouteDef> = (
	req: Request<RouteDefToReqRes<Def>>,
	err: Error,
) => Res<
	Omit<RouteDefToReqRes<Def>, 'response' | 'statusCode' | 'responseHeaders'> & {
		response: RequestError['serializedErrors']
		statusCode: RequestError['statusCode']
		responseHeaders: HeadersType
	}
>

class MiddlewareHandler<Cb extends Function> {
	private constructor(
		public cb: Cb,
		public onSetup?: HandlerSetup,
	) {}

	static make<Cb extends Function>(cb: Cb, onSetup?: HandlerSetup) {
		return new MiddlewareHandler(cb, onSetup)
	}
}

export const makeMiddleware = <Def extends RouteDef>(...args: Parameters<typeof MiddlewareHandler.make<RouteMiddlewareHandler<Def>>>) =>
	MiddlewareHandler.make(...args)
export const makeErrorMiddleware = <Def extends RouteDef>(...args: Parameters<typeof MiddlewareHandler.make<ErrorHandler<Def>>>) =>
	MiddlewareHandler.make(...args)
