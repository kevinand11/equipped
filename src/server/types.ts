import { ApiMapper } from 'ts-oas'
import { Enum } from '../enums/types'
import { CustomError } from '../errors'

import { FastifySchema } from 'fastify'
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
	ServerError: 500,
	AccountNotVerified: 460,
	AccessTokenExpired: 461,
	RefreshTokenMisused: 462,
	InvalidToken: 463
} as const

export type SupportedStatusCodes = Enum<typeof StatusCodes>

type ApiErrors = Record<Exclude<SupportedStatusCodes, 200>, CustomError['serializedErrors']>

export type ApiResponse<TResponse, StatusCode extends SupportedStatusCodes = 200> = Omit<ApiErrors, StatusCode> & Record<StatusCode, TResponse>

type Api<Key extends string> = {
    readonly key: Key
    method: MethodTypes
    body?: Record<string, any>
    params?: Record<string, any>
    query?: Record<string, any>
    response: any
}

export type ApiDef<T extends Api<any>> = ApiMapper<{
  path: T['key']
  method: Uppercase<T['method']>
  body?: T['body']
  params?: T['params']
  query?: T['query']
  responses: T['response'] extends ApiResponse<any> ? T['response'] : ApiResponse<T['response']>
}>

type Awaitable<T> = Promise<T> | T
type Res<T> = Awaitable<Response<T> | T>

export type RouteHandler<T> = (req: Request) => Res<T>
export type ErrorHandler = (req: Request, err: Error) => Res<CustomError['serializedErrors']>
export type RouteMiddlewareHandler = (req: Request) => Awaitable<void>
export type HandlerSetup = (route: Route) => void

type Schema = Omit<FastifySchema, 'tags' | 'security' | 'querystring'> & { query?: FastifySchema['querystring'] }

export type Route<Def extends ApiDef<any> = any> = {
	key?: Def['path']
	path: string
	method: Lowercase<Def['method']>
	handler: ReturnType<typeof makeController<Def['responses'] extends ApiResponse<infer R> ? R : never>>
	middlewares?: ReturnType<typeof makeMiddleware>[]
	onError?: ReturnType<typeof makeErrorMiddleware>
	schema?: Schema
	tags?: string[]
	security?: Record<string, string[]>[]
}

export type RouteConfig<T extends ApiDef<any> = any> = Omit<Route<T>, 'method' | 'handler'>
export type GeneralConfig = Omit<RouteConfig<any>, 'schema' | 'key'>
export type AddMethodImpls = {
	[Method in MethodTypes]: <T extends ApiDef<{ method: Method; key: any; response: any }>>(route: RouteConfig<T>) => <T>(...args: Parameters<typeof makeController<T>>) => void
}

class Handler<Cb extends Function> {
	constructor (public cb: Cb, public onSetup?: HandlerSetup) {}
}

export const makeController = <T>(cb: RouteHandler<T>, onSetup?: HandlerSetup) => new Handler<RouteHandler<T>>(cb, onSetup)
export const makeMiddleware = (cb: RouteMiddlewareHandler, onSetup?: HandlerSetup) => new Handler<RouteMiddlewareHandler>(cb, onSetup)
export const makeErrorMiddleware = (cb: ErrorHandler) => new Handler<ErrorHandler>(cb)
