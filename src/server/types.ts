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

type ApiErrors = Record<Exclude<SupportedStatusCodes, 200>, CustomError['serializedErrors']>

export type ApiResponse<T, StatusCode extends SupportedStatusCodes = 200> = Record<StatusCode, T> & Omit<ApiErrors, StatusCode>

type Any = object
type Arrayable<T> = T | T[]
type AllowedResponses = Arrayable<JSONPrimitives | Any>
type Api<Res = AllowedResponses, Key extends string = string, Method extends MethodTypes = MethodTypes, Body extends Any = Any, Params extends Any = Any, Query extends Any = Any> = {
    key: Key
    method: Method
    response: Res
    body?: Body
    params?: Params
    query?: Query
}

type ApiReponseWrapper<T> = JSONValue<T extends ApiResponse<any> ? T : ApiResponse<T>>

export type ApiDef<T extends Api = Api> = {
	path: T['key']
	method: Uppercase<T['method']>
	body?: Exclude<T['body'], unknown>
	params?: Exclude<T['params'], unknown>
	query?: Exclude<T['query'], unknown>
	responses: ApiReponseWrapper<T['response']>
}

type Awaitable<T> = Promise<T> | T
type Res<T> = Awaitable<Response<T> | T>

export type RouteHandler<T> = (req: Request) => Res<T>
export type ErrorHandler = (req: Request, err: Error) => Res<CustomError['serializedErrors']>
export type RouteMiddlewareHandler = (req: Request) => Awaitable<void>
export type HandlerSetup = (route: Route<any>) => void

export type RouteSchema = Omit<FastifySchema, 'tags' | 'security' | 'hide'>

export type Route<Def extends ApiDef<Api> = ApiDef<Api>> = {
	key?: Def['path']
	path: string
	method: Lowercase<Def['method']>
	handler: ReturnType<typeof makeController<Def['responses'] extends ApiResponse<infer R> ? R : never>>
	middlewares?: ReturnType<typeof makeMiddleware>[]
	onError?: ReturnType<typeof makeErrorMiddleware>
	schema?: RouteSchema
	tags?: string[]
	hideSchema?: boolean
	security?: Record<string, string[]>[]
}

export type RouteConfig<T extends ApiDef = ApiDef> = Omit<Route<T>, 'method' | 'handler'>
export type GeneralConfig = Omit<RouteConfig, 'schema' | 'key'>
export type AddMethodImpls = {
	// @ts-ignore
	[Method in MethodTypes]: <T extends ApiDef<Api<AllowedResponses, string, Method>>>(route: RouteConfig<T>) => <T>(...args: Parameters<typeof makeController<T>>) => void
}

class Handler<Cb extends Function> {
	constructor (public cb: Cb, public onSetup?: HandlerSetup) {}
}

export const makeController = <T>(cb: RouteHandler<T>, onSetup?: HandlerSetup) => new Handler<RouteHandler<T>>(cb, onSetup)
export const makeMiddleware = (cb: RouteMiddlewareHandler, onSetup?: HandlerSetup) => new Handler<RouteMiddlewareHandler>(cb, onSetup)
export const makeErrorMiddleware = (cb: ErrorHandler) => new Handler<ErrorHandler>(cb)
