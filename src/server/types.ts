import { Enum } from '../enums/types'
import { CustomError } from '../errors'

import { FastifySchema } from 'fastify'
import { Defined, JSONValue } from '../types'
import type { Request, Response } from './requests'

export const Methods = {
	get: 'get',
	post: 'post',
	put: 'put',
	patch: 'patch',
	delete: 'delete',
} as const

export type MethodTypes = Enum<typeof Methods>

export const StatusCodes = {
	Ok: 200,
	BadRequest: 400,
	NotAuthenticated: 401,
	NotAuthorized: 403,
	NotFound: 404,
	ValidationError: 422,
	TooManyRequests: 429,
	AccessTokenExpired: 461,
} as const

export type SupportedStatusCodes = Enum<typeof StatusCodes>

type GoodStatusCodes = 200
type ApiErrors = Record<Exclude<SupportedStatusCodes, GoodStatusCodes>, JSONValue<CustomError['serializedErrors']>>
type ApiResponse<T, StatusCode extends SupportedStatusCodes> = Record<StatusCode, JSONValue<T>> | Omit<ApiErrors, StatusCode>

export interface Api<
	Res = any,
	Key extends string = string,
	Method extends MethodTypes = MethodTypes,
	Body = any,
	Files extends Record<string, boolean> = Record<string, boolean>,
	Params extends Record<string, string> = Record<string, string>,
	Query extends Record<string, any> = Record<string, any>,
	DefaultStatus extends SupportedStatusCodes = SupportedStatusCodes
> {
    key: Key
    method: Method
    response: Res
    body?: Body
	files?: Files
    params?: Params
    query?: Query
	defaultStatusCode?: DefaultStatus
}
export interface ApiDef<T extends AnyApi> {
	key: Defined<T['key']>
	method: Defined<T['method']>
	body: Defined<T['body']>
	params: Defined<T['params']>
	query: Defined<T['query']>
	files: Defined<T['files']>
	responses: ApiResponse<T['response'], GetDefaultStatusCode<T['defaultStatusCode']>>
}

type AnyApi<Method extends MethodTypes = MethodTypes> = Api<any, any, Method, any, any, any, any, any>
type Awaitable<T> = Promise<T> | T
type Res<T, S extends SupportedStatusCodes> = Awaitable<Response<T, S> | T>
type InferApiFromApiDef<T> = T extends ApiDef<infer A> ? A : never
type GetDefaultStatusCode<T extends Api['defaultStatusCode']> = T extends SupportedStatusCodes ? T : 200

export type RouteHandler<Def extends Api = Api> = (req: Request<Def>) => Res<Def['response'], GetDefaultStatusCode<Def['defaultStatusCode']>>
export type ErrorHandler<Def extends Api = Api> = (req: Request<Def>, err: Error) => Res<CustomError['serializedErrors'], GetDefaultStatusCode<Def['defaultStatusCode']>>
export type RouteMiddlewareHandler<Def extends Api = Api> = (req: Request<Def>) => Awaitable<void>
export type HandlerSetup = (route: Route) => void

export type RouteSchema = Omit<FastifySchema, 'tags' | 'security' | 'hide'>

export interface Route<Def extends ApiDef<AnyApi> = ApiDef<Api>> {
	key?: Def['key']
	path: string
	method: Def['method']
	handler: RouteHandler<InferApiFromApiDef<Def>>
	onSetupHandler?: HandlerSetup
	middlewares?: ReturnType<typeof makeMiddleware>[]
	onError?: ReturnType<typeof makeErrorMiddleware>
	schema?: RouteSchema
	tags?: string[]
	hideSchema?: boolean
	security?: Record<string, string[]>[]
}

export type RouteConfig<T extends ApiDef<AnyApi> = ApiDef<Api>> = Omit<Route<T>, 'method' | 'handler'>
export type GeneralConfig = Omit<RouteConfig, 'schema' | 'key'>
export type AddMethodImpls = {
	[Method in MethodTypes]: <T extends ApiDef<AnyApi<Method>> = ApiDef<AnyApi<Method>>>(route: RouteConfig<T>) => (handler: RouteHandler<InferApiFromApiDef<T>>) => Route<T>
}

class MiddlewareHandler<Cb extends Function> {
	private constructor (public cb: Cb, public onSetup?: HandlerSetup) { }

	static make<Cb extends Function> (cb: Cb, onSetup?: HandlerSetup) {
		return new MiddlewareHandler(cb, onSetup)
	}
}

export const makeMiddleware = <Def extends AnyApi = Api>(...args: Parameters<typeof MiddlewareHandler.make<RouteMiddlewareHandler<Def>>>) => MiddlewareHandler.make(...args)
export const makeErrorMiddleware = <Def extends AnyApi = Api> (...args: Parameters<typeof MiddlewareHandler.make<ErrorHandler<Def>>>) => MiddlewareHandler.make(...args)
