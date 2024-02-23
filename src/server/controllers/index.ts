import { Request as ERequest, Response as EResponse, ErrorRequestHandler, Handler, NextFunction } from 'express'
import { StatusCodes } from '../statusCodes'
import { Request as CustomRequest } from './request'
import { Response } from './response'

type CustomResponse<T> = Response<T> | T
export type Controller = Handler | ErrorRequestHandler
export type RouteHandler<T> = (req: CustomRequest) => Promise<CustomResponse<T>>

export const makeController = <T>(cb: RouteHandler<T>): Controller => {
	return async (req: ERequest, res: EResponse, next: NextFunction) => {
		try {
			const rawResponse = await cb(await CustomRequest.make(req, res))
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse })
			if (!response.piped) {
				Object.entries(response.headers).forEach(([key, value]) => res.header(key, value))
				const type = response.shouldJSONify ? 'json' : 'send'
				res.status(response.status)[type](response.body).end()
			}
		} catch (e) {
			next(e)
		}
	}
}

export const makeMiddleware = <T>(cb: RouteHandler<T>): Controller => {
	return async (req: ERequest, res: EResponse, next: NextFunction) => {
		try {
			await cb(await CustomRequest.make(req, res))
			return next()
		} catch (e) {
			return next(e)
		}
	}
}

export const makeErrorMiddleware = <T>(cb: (_: CustomRequest, __: Error) => Promise<CustomResponse<T>>): Controller => {
	return async (err: Error, req: ERequest, res: EResponse, _: NextFunction) => {
		const rawResponse = await cb(await CustomRequest.make(req, res), err)
		const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse, status: StatusCodes.BadRequest })
		if (!response.piped) {
			Object.entries(response.headers).forEach(([key, value]) => res.header(key, value))
			res.status(response.status).send(response.body).end()
		}
	}
}