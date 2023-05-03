import { ErrorRequestHandler, Handler, NextFunction, Request, Response } from 'express'
import { Writable } from 'stream'
import { StatusCodes, SupportedStatusCodes } from '../statusCodes'
import { Request as CustomRequest } from './request'

type CustomResponse = {
	result: any,
	status?: SupportedStatusCodes,
	headers?: Record<string, any>
	piped?: boolean
}

type ExtraArgs = {
	pipeThrough?: Writable
}

export type Controller = Handler | ErrorRequestHandler
const defaultHeaders = { 'Content-Type': 'application/json' }

export const makeController = (cb: (_: CustomRequest, extras: ExtraArgs) => Promise<CustomResponse>): Controller => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const extras = {
				pipeThrough: res
			}
			const { status = StatusCodes.Ok, result, headers = defaultHeaders, piped = false } = await cb(await CustomRequest.make(req), extras)
			if (!piped) {
				Object.entries(headers).forEach(([key, value]) => res.header(key, value))
				res.status(status).send(result).end()
			}
		} catch (e) {
			next(e)
		}
	}
}

export const makeMiddleware = (cb: (_: CustomRequest, extras: ExtraArgs) => Promise<void>): Controller => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const extras = {
				pipeThrough: res
			}
			await cb(await CustomRequest.make(req), extras)
			return next()
		} catch (e) {
			return next(e)
		}
	}
}

export const makeErrorMiddleware = (cb: (_: CustomRequest, __: Error, extras: ExtraArgs) => Promise<CustomResponse>): Controller => {
	return async (err: Error, req: Request, res: Response, _: NextFunction) => {
		const extras = {
			pipeThrough: res
		}
		const { status = StatusCodes.BadRequest, result, headers = defaultHeaders, piped = false } = await cb(await CustomRequest.make(req), err, extras)
		if (!piped) {
			Object.entries(headers).forEach(([key, value]) => res.header(key, value))
			res.status(status).send(result).end()
		}
	}
}