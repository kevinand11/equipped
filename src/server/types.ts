import { Enum } from '../enums/types'
import { CustomError } from '../errors'

import { FastifySchema } from 'fastify'
import { JSONPrimitives, JSONValue } from '../types'
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

type Any = object | unknown
type Arrayable<T> = T | T[]
type AllowedResponses = Arrayable<JSONPrimitives | Any>
export interface Api<
	Res = AllowedResponses,
	Key extends string = string,
	Method extends MethodTypes = MethodTypes,
	Body extends Any = Any,
	Params extends Any = Any,
	Query extends Any = Any,
	DefaultStatus extends SupportedStatusCodes = SupportedStatusCodes
> {
    key: Key
    method: Method
    response: Res
    body?: Body
    params?: Params
    query?: Query
	defaultStatusCode?: DefaultStatus
}
export interface ApiDef<T extends Api = Api> {
	key: T['key']
	method: T['method']
	body: T['body']
	params: T['params']
	query: T['query']
	responses: ApiResponse<T['response'], GetDefaultStatusCode<T['defaultStatusCode']>>
	__api?: T
}

type Awaitable<T> = Promise<T> | T
type Res<T, S extends SupportedStatusCodes> = Awaitable<Response<T, S> | T>
type InferApiFromApiDef<T> = T extends ApiDef<infer A> ? A : never
type GetDefaultStatusCode<T extends Api['defaultStatusCode']> = T extends SupportedStatusCodes ? T : 200

export type RouteHandler<Def extends Api = Api> = (req: Request<Def>) => Res<Def['response'], GetDefaultStatusCode<Def['defaultStatusCode']>>
export type ErrorHandler<Def extends Api = Api> = (req: Request<Def>, err: Error) => Res<CustomError['serializedErrors'], GetDefaultStatusCode<Def['defaultStatusCode']>>
export type RouteMiddlewareHandler<Def extends Api = Api> = (req: Request<Def>) => Awaitable<void>
export type HandlerSetup = (route: Route) => void

export type RouteSchema = Omit<FastifySchema, 'tags' | 'security' | 'hide'>

export interface Route<Def extends ApiDef = ApiDef> {
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
	__def?: Def
}

export type RouteConfig<T extends ApiDef = ApiDef> = Omit<Route<T>, 'method' | 'handler'>
export type GeneralConfig = Omit<RouteConfig, 'schema' | 'key'>
export type AddMethodImpls = {
	// @ts-ignore
	[Method in MethodTypes]: <T extends ApiDef<Api<AllowedResponses, string, Method>>>(route: RouteConfig<T>) => (handler: RouteHandler<InferApiFromApiDef<T>>) => Route<T>
}

class MiddlewareHandler<Cb extends Function> {
	private constructor (public cb: Cb, public onSetup?: HandlerSetup) { }

	static make<Cb extends Function> (cb: Cb, onSetup?: HandlerSetup) {
		return new MiddlewareHandler(cb, onSetup)
	}
}

export const makeMiddleware = <Def extends Api = Api>(...args: Parameters<typeof MiddlewareHandler.make<RouteMiddlewareHandler<Def>>>) => MiddlewareHandler.make(...args)
export const makeErrorMiddleware = <Def extends Api = Api> (...args: Parameters<typeof MiddlewareHandler.make<ErrorHandler<Def>>>) => MiddlewareHandler.make(...args)
