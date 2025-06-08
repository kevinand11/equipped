import http from 'http'

import { prepareOpenapiMethod } from '@fastify/swagger/lib/spec/openapi/utils'
import openapi from '@wesleytodd/openapi'
import cookie from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fileUpload from 'express-fileupload'
import { rateLimit } from 'express-rate-limit'
// import slowDown from 'express-slow-down'
import helmet from 'helmet'
// @ts-ignore
import resolver from 'json-schema-resolver'
import { pinoHttp } from 'pino-http'

import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { getMediaDuration } from '../../utils/media'
import { Request } from '../requests'
import { IncomingFile, StatusCodes } from '../types'
import { Server } from './base'

export class ExpressServer extends Server<express.Request, express.Response> {
	#expressApp: express.Express
	#oapi = openapi(this.openapiJsonUrl.replace('.json', ''), this.baseOpenapiDoc, { coerce: false })
	#ref = resolver({ clone: true })

	constructor() {
		const app = express()
		super(http.createServer(app), {
			parseRequest: async (req) => {
				const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
				const headers = {
					...allHeaders,
					Authorization: req.get('authorization'),
					RefreshToken: req.get('x-refresh-token'),
					ApiKey: req.get('x-api-key'),
					ContentType: req.get('content-type'),
					Referer: req.get('referer'),
					UserAgent: req.get('user-agent'),
				}
				const files = Object.fromEntries(
					await Promise.all(
						Object.entries(req.files ?? {}).map(async ([key, file]) => {
							const uploads = Array.isArray(file) ? file : [file]
							const fileArray: IncomingFile[] = await Promise.all(
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

				return new Request<any>({
					ip: req.ip,
					body: req.body ?? {},
					cookies: req.cookies ?? {},
					params: req.params ?? {},
					query: req.query ?? {},
					method: <any>req.method,
					path: req.path,
					headers,
					files,
				})
			},
			handleResponse: async (res, response) => {
				if (!response.piped) {
					Object.entries(<object>response.headers).forEach(([key, value]) => res.header(key, value))
					const type = response.shouldJSONify ? 'json' : 'send'
					res.status(response.status)[type](response.body).end()
				} else {
					response.body.pipe(res)
				}
			},
			registerRoute: (route, cb) => {
				const openapi = prepareOpenapiMethod(route.jsonSchema, this.#ref, this.baseOpenapiDoc, route.path)
				const controllers = [!route.jsonSchema.hide ? this.#oapi.path(openapi) : undefined, cb].filter(Boolean)
				this.#expressApp[route.method]?.(route.path, ...controllers)
			},
			registerErrorHandler: (cb) => {
				this.#expressApp.use(async (err, req, res, _next) => cb(err, req, res))
			},
			registerNotFoundHandler: (cb) => {
				this.#expressApp.use(cb)
			},
			start: async (port) =>
				new Promise((resolve: (s: boolean) => void, reject: (e: Error) => void) => {
					try {
						const app = this.server.listen({ host: '0.0.0.0', port }, async () => resolve(true))
						addWaitBeforeExit(app.close)
					} catch (err) {
						reject(<Error>err)
					}
				}),
		})
		this.#expressApp = app

		app.disable('x-powered-by')
		if (this.settings.requests.log) app.use(pinoHttp({ logger: Instance.get().logger }))
		app.use(express.json())
		app.use(express.text())
		app.use(cookie())
		app.use(
			helmet({
				crossOriginResourcePolicy: { policy: 'cross-origin' },
				contentSecurityPolicy: false,
			}),
		)
		app.use(cors(this.cors))
		app.use(express.urlencoded({ extended: false }))
		if (this.staticPath) app.use(express.static(this.staticPath))
		app.use(this.#oapi)
		app.use(
			fileUpload({
				limits: { fileSize: this.settings.requests.maxFileUploadSizeInMb * 1024 * 1024 },
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
}
