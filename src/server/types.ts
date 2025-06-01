import type { FastifySchema } from 'fastify'

import type { RequestError } from '../errors'
import type { Defined, EnumToStringUnion, Flatten, IsInTypeList, IsType, JSONValue } from '../types'
import type { Request, Response } from './requests'

export enum Methods {
	get = 'get',
	post = 'post',
	put = 'put',
	patch = 'patch',
	delete = 'delete',
	options = 'options',
}

export enum StatusCodes {
	Ok = 200,
	Found = 302,
	BadRequest = 400,
	NotAuthenticated = 401,
	NotAuthorized = 403,
	NotFound = 404,
	ValidationError = 422,
	TooManyRequests = 429,
	AuthorizationExpired = 461,
}

type GoodStatusCodes = StatusCodes.Ok | StatusCodes.Found
type BadStatusCodes = Exclude<StatusCodes, GoodStatusCodes>
type ApiErrors = Record<BadStatusCodes, JSONValue<RequestError['serializedErrors']>>
type ApiResponse<T, StatusCode extends StatusCodes> = Record<StatusCode, JSONValue<T>> | Omit<ApiErrors, StatusCode>

export interface Api<
	Res = any,
	Key extends string = string,
	Method extends Methods | EnumToStringUnion<typeof Methods> = Methods | EnumToStringUnion<typeof Methods>,
	Body = any,
	Params extends Record<string, string> = Record<string, string>,
	Query extends Record<string, any> = Record<string, any>,
	RequestHeaders extends HeadersType = HeadersType,
	ResponseHeaders extends HeadersType = HeadersType,
	DefaultStatus extends StatusCodes = StatusCodes,
> {
	key: Key
	method: Method
	response: Res
	body?: Body
	params?: Params
	query?: Query
	requestHeaders?: RequestHeaders
	responseHeaders?: ResponseHeaders
	defaultStatusCode?: DefaultStatus
}

export type HeadersType = Record<string, string | string[] | undefined>
export type FileSchema = 'equipped-file-schema'

export interface ApiDef<T extends Api> {
	key: T['key']
	method: T['method']
	body: Flatten<GetApiPart<T, 'body', false>>
	params: Flatten<GetApiPart<T, 'params', false>>
	query: Flatten<GetApiPart<T, 'query', false>>
	requestHeaders: Flatten<GetApiPart<T, 'requestHeaders', false>>
	responseHeaders: Flatten<GetApiPart<T, 'responseHeaders', false>>
	responses: Flatten<ApiResponse<T['response'], GetApiPart<T, 'defaultStatusCode', true, 200>>>
	__apiDef: true
}

type Awaitable<T> = Promise<T> | T
type Res<T, S extends StatusCodes, H extends HeadersType> = Awaitable<
	IsInTypeList<S, [StatusCodes, StatusCodes.Ok, unknown]> extends true
		? IsInTypeList<H, [HeadersType, unknown]> extends true
			? Response<T, S, H> | T
			: Response<T, S, H>
		: Response<T, S, H>
>
type InferApiFromApiDef<T> = T extends ApiDef<infer A> ? A : never
type ExcludeUnknown<T, D> = IsType<T, unknown> extends true ? D : T
export type GetApiPart<
	T extends Api,
	K extends keyof Api,
	Def extends boolean = true,
	Default extends Api[K] = Def extends true ? Defined<Api[K]> : Api[K],
> =
	IsInTypeList<K, ['key', 'method', 'body']> extends true
		? T[K]
		: Def extends true
			? ExcludeUnknown<Defined<T[K]>, Default>
			: ExcludeUnknown<T[K], Default>

export type RouteHandler<Def extends Api = Api> = (
	req: Request<Def>,
) => Res<Def['response'], GetApiPart<Def, 'defaultStatusCode'>, GetApiPart<Def, 'responseHeaders'>>
export type ErrorHandler<Def extends Api = Api> = (
	req: Request<Def>,
	err: Error,
) => Res<RequestError['serializedErrors'], RequestError['statusCode'], HeadersType>
export type RouteMiddlewareHandler<Def extends Api = Api> = (req: Request<Def>) => Awaitable<void>
export type HandlerSetup = (route: Route) => void

export type RouteSchema = Omit<FastifySchema, 'tags' | 'security' | 'hide' | 'description'> & { descriptions?: string[]; title?: string }
type RouteGroup = { name: string; description?: string }

export interface Route<Def extends ApiDef<Api> = ApiDef<Api>> {
	key?: Def['key']
	path: string
	method: Def['method']
	handler: RouteHandler<InferApiFromApiDef<Def>>
	onSetupHandler?: HandlerSetup
	middlewares?: ReturnType<typeof makeMiddleware>[]
	onError?: ReturnType<typeof makeErrorMiddleware>
	schema?: RouteSchema
	groups?: (RouteGroup | RouteGroup['name'])[]
	descriptions?: string[]
	hideSchema?: boolean
	security?: Record<string, string[]>[]
}

export type RouteConfig<T extends ApiDef<Api> = ApiDef<Api>> = Omit<Route<T>, 'method' | 'handler'>
export type GeneralConfig = Omit<RouteConfig, 'schema' | 'key'>
export type AddMethodImpls = {
	[Method in Methods]: <T extends ApiDef<any>>(route: RouteConfig<T>) => (handler: RouteHandler<InferApiFromApiDef<T>>) => Route<T>
}

class MiddlewareHandler<Cb extends Function> {
	private constructor(
		public cb: Cb,
		public onSetup?: HandlerSetup,
	) {}

	static make<Cb extends Function>(cb: Cb, onSetup?: HandlerSetup) {
		return new MiddlewareHandler(cb, onSetup)
	}
}

export const makeMiddleware = <Def extends Api = Api>(...args: Parameters<typeof MiddlewareHandler.make<RouteMiddlewareHandler<Def>>>) =>
	MiddlewareHandler.make(...args)
export const makeErrorMiddleware = <Def extends Api = Api>(...args: Parameters<typeof MiddlewareHandler.make<ErrorHandler<Def>>>) =>
	MiddlewareHandler.make(...args)
