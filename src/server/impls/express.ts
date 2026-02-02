import http from 'http'

import cookie from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fileUpload from 'express-fileupload'
import { rateLimit } from 'express-rate-limit'
// import slowDown from 'express-slow-down'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'

import { Instance } from '../../instance'
import { getMediaDuration } from '../../utilities'
import type { ServerConfig } from '../pipes'
import { Request } from '../requests'
import { type IncomingFile, StatusCodes } from '../types'
import { Server } from './base'

export class ExpressServer extends Server<express.Request, express.Response> {
	#expressApp: express.Express

	constructor(config: ServerConfig) {
		const app = express()
		const instance = Instance.get()
		super(http.createServer(app), config, {
			parseRequest: async (req) => {
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
					headers: req.headers,
					files,
				})
			},
			handleResponse: async (res, response) => {
				if (!response.piped) {
					Object.entries(response.headers).forEach(([key, value]) => res.header(key, value as string))
					Object.entries(response.cookies).forEach(([key, { value, ...opts }]) => res.cookie(key, value, opts))
					const type = response.body === null || response.body === undefined ? 'json' : 'send'
					res.status(response.status)[type](response.body).end()
				} else {
					response.body.pipe(res)
				}
			},
			registerRoute: (method, path, cb) => {
				this.#expressApp[method]?.(path, cb)
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
						Instance.on('close', app.close, 1)
					} catch (err) {
						reject(<Error>err)
					}
				}),
		})
		this.#expressApp = app

		app.disable('x-powered-by')
		if (config.requests.log) app.use(pinoHttp({ logger: instance.log }))
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
		if (config.publicPath) app.use(express.static(config.publicPath))
		app.use(
			fileUpload({
				limits: { fileSize: instance.settings.utils.maxFileUploadSizeInMb * 1024 * 1024 },
				useTempFiles: false,
			}),
		)
		if (config.requests.rateLimit.enabled)
			app.use(
				rateLimit({
					windowMs: config.requests.rateLimit.periodInMs,
					limit: config.requests.rateLimit.limit,
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
