import http from 'http'

import { prepareOpenapiMethod } from '@fastify/swagger/lib/spec/openapi/utils'
import openapi from '@wesleytodd/openapi'
import cookie from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fileUpload from 'express-fileupload'
import { rateLimit } from 'express-rate-limit'
// import slowDown from 'express-slow-down'
import type { FastifySchemaValidationError } from 'fastify/types/schema'
import helmet from 'helmet'
// @ts-ignore
import resolver from 'json-schema-resolver'
import { pinoHttp } from 'pino-http'

import { ValidationError } from '../../errors'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import type { StorageFile } from '../../storage'
import type { Defined } from '../../types'
import { getMediaDuration } from '../../utils/media'
import { errorHandler, notFoundHandler } from '../middlewares'
import { Request, Response } from '../requests'
import type { Route } from '../types'
import { StatusCodes } from '../types'
import type { FullRoute } from './base'
import { Server } from './base'

export class ExpressServer extends Server<express.Request, express.Response> {
	#expressApp: express.Express
	#oapi = openapi(this.openapiJsonUrl.replace('.json', ''), this.baseOpenapiDoc, { coerce: false })
	#ref = resolver({ clone: true })

	constructor() {
		const app = express()
		super(http.createServer(app))
		this.#expressApp = app

		app.disable('x-powered-by')
		if (this.settings.logRequests) app.use(pinoHttp({ logger: Instance.get().logger }))
		app.use(express.json())
		app.use(express.text())
		app.use(cookie())
		app.use(
			helmet({
				crossOriginResourcePolicy: { policy: 'cross-origin' },
				contentSecurityPolicy: false,
			}),
		)
		app.use(cors({ origin: '*' }))
		app.use(express.urlencoded({ extended: false }))
		app.use(express.static(this.staticPath))
		app.use(this.#oapi)
		app.use(
			fileUpload({
				limits: { fileSize: this.settings.maxFileUploadSizeInMb * 1024 * 1024 },
				useTempFiles: false,
			}),
		)
		if (this.settings.rateLimit.enabled)
			app.use(
				rateLimit({
					windowMs: this.settings.rateLimit.periodInMs,
					limit: this.settings.rateLimit.limit,
					handler: (_: express.Request, res: express.Response) =>
						res.status(StatusCodes.TooManyRequests).json([{ message: 'Too Many Requests' }]),
				}),
			)
		/* if (this.settings.slowdown.enabled) app.use(slowDown({
			windowMs: this.settings.slowdown.periodInMs,
			delayAfter: this.settings.slowdown.delayAfter,
			delayMs: this.settings.slowdown.delayInMs
		})) */
	}

	protected registerRoute(route: FullRoute) {
		const openapi = prepareOpenapiMethod(route.schema, this.#ref, this.baseOpenapiDoc, route.path)
		const controllers: (express.RequestHandler | express.ErrorRequestHandler)[] = [
			...route.middlewares.map((m) => this.makeMiddleware(m.cb)),
			this.makeController(route.handler),
		]
		if (!route.schema.hide)
			controllers.unshift(
				this.#oapi[this.settings.requestSchemaValidation ? 'validPath' : 'path'](openapi),
				(error: Error, _, __, next) => {
					if ('validationErrors' in error) {
						const validationErrors = <FastifySchemaValidationError[]>error.validationErrors
						throw new ValidationError(
							validationErrors.map((error) => ({
								messages: [error.message ?? ''],
								field: error.instancePath.replaceAll('/', '.').split('.').filter(Boolean).join('.'),
							})),
						)
					}
					next()
				},
			)
		if (route.onError) controllers.push(this.makeErrorMiddleware(route.onError.cb))
		this.#expressApp[route.method]?.(route.path, ...controllers)
	}

	protected async startServer(port: number) {
		this.#expressApp.use(this.makeMiddleware(notFoundHandler.cb))
		this.#expressApp.use(this.makeErrorMiddleware(errorHandler.cb))

		return await new Promise((resolve: (s: boolean) => void, reject: (e: Error) => void) => {
			try {
				const app = this.server.listen({ host: '0.0.0.0', port }, async () => resolve(true))
				addWaitBeforeExit(app.close)
			} catch (err) {
				reject(<Error>err)
			}
		})
	}

	protected async onLoad() {}

	protected async parse(req: express.Request): Promise<Request> {
		const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
		const headers = {
			...allHeaders,
			AccessToken: req.get('Access-Token'),
			RefreshToken: req.get('Refresh-Token'),
			ContentType: req.get('Content-Type'),
			Referer: req.get('referer'),
			UserAgent: req.get('User-Agent'),
		}
		const files = Object.fromEntries(
			await Promise.all(
				Object.entries(req.files ?? {}).map(async ([key, file]) => {
					const uploads = Array.isArray(file) ? file : [file]
					const fileArray: StorageFile[] = await Promise.all(
						uploads.map(async (f) => ({
							name: f.name,
							type: f.mimetype,
							size: f.size,
							isTruncated: f.truncated,
							data: f.data,
							duration: await getMediaDuration(f.data),
						})),
					)
					return <const>[key, fileArray]
				}),
			),
		)

		// @ts-ignore
		return (req.savedReq ||= new Request({
			ip: req.ip,
			body: req.body ?? {},
			cookies: req.cookies ?? {},
			params: req.params ?? {},
			query: req.query ?? {},
			method: <any>req.method,
			path: req.path,
			headers,
			files,
		}))
	}

	makeController(cb: Defined<Route['handler']>) {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				const request = await this.parse(req)
				const rawResponse = await cb(request)
				const response = rawResponse instanceof Response ? rawResponse : request.res({ body: rawResponse })
				if (!response.piped) {
					Object.entries(<object>response.headers).forEach(([key, value]) => res.header(key, value))
					const type = response.shouldJSONify ? 'json' : 'send'
					res.status(response.status)[type](response.body).end()
				} else {
					response.body.pipe(res)
				}
			} catch (e) {
				next(e)
			}
		}
	}

	makeMiddleware(cb: Defined<Route['middlewares']>[number]['cb']) {
		return async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
			try {
				await cb(await this.parse(req))
				return next()
			} catch (e) {
				return next(e)
			}
		}
	}

	makeErrorMiddleware(cb: Defined<Route['onError']>['cb']) {
		return async (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
			const request = await this.parse(req)
			const rawResponse = await cb(request, err)
			const response =
				rawResponse instanceof Response ? rawResponse : request.res({ body: rawResponse, status: StatusCodes.BadRequest })
			if (!response.piped) {
				Object.entries(response.headers).forEach(([key, value]) => value && res.header(key, value))
				res.status(response.status).send(response.body).end()
			} else {
				response.body.pipe(res)
			}
		}
	}
}
