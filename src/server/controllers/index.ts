import { ErrorRequestHandler, Handler, NextFunction, Request, Response } from 'express'
import { StatusCodes, SupportedStatusCodes } from '../statusCodes'
import { Request as CustomRequest } from './request'

type CustomResponse = {
	status: SupportedStatusCodes,
	result: any,
	headers?: Record<string, any>
}

export type Controller = Handler | ErrorRequestHandler

export const makeController = (cb: (_: CustomRequest) => Promise<CustomResponse>): Controller => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { status = StatusCodes.Ok, result, headers = {} } = await cb(await CustomRequest.make(req))
			Object.entries(headers).forEach(([key, value]) => res.header(key, value))
			return res.status(status).json(result).end()
		} catch (e) {
			next(e)
			return
		}
	}
}

export const makeMiddleware = (cb: (_: CustomRequest) => Promise<void>): Controller => {
	return async (req: Request, _: Response, next: NextFunction) => {
		try {
			await cb(await CustomRequest.make(req))
			return next()
		} catch (e) {
			return next(e)
		}
	}
}

export const makeErrorMiddleware = (cb: (_: CustomRequest, __: Error) => Promise<CustomResponse>): Controller => {
	return async (err: Error, req: Request, res: Response, _: NextFunction) => {
		const { status = StatusCodes.BadRequest, result, headers = {} } = await cb(await CustomRequest.make(req), err)
		Object.entries(headers).forEach(([key, value]) => res.header(key, value))
		return res.status(status).json(result).end()
	}
}