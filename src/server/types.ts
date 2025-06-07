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

export type DefaultHeaders = Record<string, ArrayOrValue<string>>
export type FileSchema = 'equipped-file-schema'

type ArrayOrValue<T> = T | T[] | undefined

export type RouteDef = Readonly<{
	body?: Pipe<unknown, unknown, any>
	response?: Pipe<unknown, unknown, any>
	params?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>, any>
	headers?: Pipe<DefaultHeaders, DefaultHeaders, any>
	responseHeaders?: Pipe<DefaultHeaders, DefaultHeaders, any>
	query?: Pipe<Record<string, ArrayOrValue<string>>, Record<string, ArrayOrValue<string>>, any>
	defaultStatusCode?: StatusCodesEnum
	hide?: boolean
}>

type RouteGroup = { name: string; description?: string }
type HandlerSetup<T extends RouteDef> = (route: Route<T>) => void

export type RouteConfig<T extends RouteDef> = {
	onSetupHandler?: HandlerSetup<T>
	middlewares?: ReturnType<typeof makeMiddleware<T>>[]
	onError?: ReturnType<typeof makeErrorMiddleware<T>>
	groups?: (RouteGroup | RouteGroup['name'])[]
	title?: string
	descriptions?: string[]
	security?: Record<string, string[]>[]
}

type RouteDefConfig<T extends RouteDef> = RouteConfig<T> & { schema?: T }
export type RouteGeneralConfig<T extends RouteDef> = RouteConfig<T> & { path: string }

export type Route<T extends RouteDef> = RouteDefConfig<T> & {
	path: string
	method: MethodsEnum
	handler: RouteDefHandler<T>
}

export type GetApiPart<T extends RouteDef, K extends keyof RouteDef> = NonNullable<
	IsInTypeList<T[K], [unknown]> extends true ? RouteDef[K] : T[K]
>

export type RouteDefToReqRes<T extends RouteDef> = Prettify<{
	body: PipeInput<GetApiPart<T, 'body'>>
	params: PipeInput<GetApiPart<T, 'params'>>
	requestHeaders: PipeInput<GetApiPart<T, 'headers'>>
	query: PipeInput<GetApiPart<T, 'query'>>
	response: PipeInput<GetApiPart<T, 'response'>>
	responseHeaders: PipeInput<GetApiPart<T, 'responseHeaders'>>
	statusCode: GetApiPart<T, 'defaultStatusCode'>
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
export type AddMethodDefImpls = {
	[Method in MethodsEnum]: <T extends RouteDef>(path: string, config?: RouteDefConfig<T>) => (handler: RouteDefHandler<T>) => Route<T>
}

type RouteMiddlewareHandler<Def extends RouteDef> = (req: Request<RouteDefToReqRes<Def>>) => Awaitable<void>
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
