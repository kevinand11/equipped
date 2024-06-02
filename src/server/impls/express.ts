import { prepareOpenapiMethod } from '@fastify/swagger/lib/spec/openapi/utils'
import openapi from '@wesleytodd/openapi'
import cookie from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fileUpload from 'express-fileupload'
import rateLimit from 'express-rate-limit'
// import slowDown from 'express-slow-down'
import { FastifySchemaValidationError } from 'fastify/types/schema'
import helmet from 'helmet'
import http from 'http'
// @ts-ignore
import resolver from 'json-schema-resolver'
import { pinoHttp } from 'pino-http'

import { ValidationError } from '../../errors'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { StorageFile } from '../../storage'
import { Defined } from '../../types'
import { getMediaDuration } from '../../utils/media'
import { errorHandler, notFoundHandler } from '../middlewares'
import { Request, Response } from '../requests'
import { Route, StatusCodes } from '../types'
import { FullRoute, Server } from './base'

export class ExpressServer extends Server<express.Request, express.Response> {
	#expressApp: express.Express
	#oapi = openapi(`${this.settings.openapiDocsUrl}/json`, this.baseOpenapiDoc, { coerce: false })
	#ref = resolver({ clone: true })

	constructor () {
		const app = express()
		super(http.createServer(app))
		this.#expressApp = app

		app.disable('x-powered-by')
		if (this.settings.logRequests) app.use(pinoHttp({ logger: Instance.get().logger }))
		app.use(express.json())
		app.use(express.text())
		app.use(cookie())
		app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }))
		app.use(cors({ origin: '*' }))
		app.use(express.urlencoded({ extended: false }))
		app.use(express.static(this.staticPath))
		app.use( this.#oapi)
		app.use(this.settings.openapiDocsUrl, this.#oapi.swaggerui())
		app.use(
			fileUpload({
				limits: { fileSize: this.settings.maxFileUploadSizeInMb * 1024 * 1024 },
				useTempFiles: false
			})
		)
		if (this.settings.useRateLimit) app.use(rateLimit({
			windowMs: this.settings.rateLimitPeriodInMs,
			limit: this.settings.rateLimit,
			handler: (_: express.Request, res: express.Response) => res.status(StatusCodes.TooManyRequests).json([{ message: 'Too Many Requests' }])
		}))
		/* if (this.settings.useSlowDown) app.use(slowDown({
			windowMs: this.settings.slowDownPeriodInMs,
			delayAfter: this.settings.slowDownAfter,
			delayMs: this.settings.slowDownDelayInMs
		})) */
	}

	protected registerRoute (route: FullRoute) {
		const openapi = prepareOpenapiMethod(route.schema, this.#ref, this.baseOpenapiDoc, route.path)
		const controllers: (express.RequestHandler | express.ErrorRequestHandler)[] = [
			...route.middlewares.map((m) => this.makeMiddleware(m.cb)),
			this.makeController(route.handler)
		]
		if (!route.schema.hide) controllers.unshift(
			this.#oapi[this.settings.requestSchemaValidation ? 'validPath' : 'path'](openapi),
			(error: Error, _, __, next) => {
				if ('validationErrors' in error) {
					const validationErrors = error.validationErrors as FastifySchemaValidationError[]
					throw new ValidationError(validationErrors.map((error) => ({
						messages: [error.message ?? ''],
						field: error.instancePath.replaceAll('/', '.').split('.').filter(Boolean).join('.')
					})))
				}
				next()
			}
		)
		if (route.onError) controllers.push(this.makeErrorMiddleware(route.onError.cb))
		this.#expressApp[route.method]?.(route.path, ...controllers)
	}

	protected async startServer (port: number) {
		this.#expressApp.use(this.makeMiddleware(notFoundHandler.cb))
		this.#expressApp.use(this.makeErrorMiddleware(errorHandler.cb))

		return await new Promise((resolve: (s: boolean) => void, reject: (e: Error) => void) => {
			try {
				const app = this.server.listen({ host: '0.0.0.0', port }, async () => resolve(true))
				addWaitBeforeExit(app.close)
			} catch (err) {
				reject(err as Error)
			}
		})
	}

	protected async onLoad () {}

	protected async parse (req: express.Request, res: express.Response) {
		const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
		const headers = {
			...allHeaders,
			AccessToken: req.get('Access-Token') ?? null,
			RefreshToken: req.get('Refresh-Token') ?? null,
			ContentType: req.get('Content-Type') ?? null,
			Referer: req.get('referer') ?? null,
			UserAgent: req.get('User-Agent') ?? null
		}
		const files = Object.fromEntries(
			await Promise.all(
				Object.entries(req.files ?? {}).map(async ([key, file]) => {
					const uploads = Array.isArray(file) ? file : [file]
					const fileArray: StorageFile[] = await Promise.all(uploads.map(async (f) => ({
						name: f.name,
						type: f.mimetype,
						size: f.size,
						isTruncated: f.truncated,
						data: f.data,
						duration: await getMediaDuration(f.data),
					})))
					return [key, fileArray] as const
				})
			)
		)

		// @ts-ignore
		return req.savedReq ||= new Request({
			ip: req.ip,
			body: req.body ?? {},
			cookies: req.cookies ?? {},
			params: req.params ?? {},
			query: req.query ?? {},
			method: req.method as any,
			path: req.path,
			headers, files,
		}, res)
	}

	makeController(cb: Defined<Route['handler']>) {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				const rawResponse = await cb(await this.parse(req, res))
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

	makeMiddleware(cb: Defined<Route['middlewares']>[number]['cb']) {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				await cb(await this.parse(req, res))
				return next()
			} catch (e) {
				return next(e)
			}
		}
	}

	makeErrorMiddleware(cb: Defined<Route['onError']>['cb']) {
		return async (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
			const rawResponse = await cb(await this.parse(req, res), err)
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse, status: StatusCodes.BadRequest })
			if (!response.piped) {
				Object.entries(response.headers).forEach(([key, value]) => res.header(key, value))
				res.status(response.status).send(response.body).end()
			}
		}
	}
}