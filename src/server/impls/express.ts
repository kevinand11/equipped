import express from 'express'
import http from 'http'
import { Listener } from '../../listeners'
import { Defined, Server } from './base'

import cookie from 'cookie-parser'
import cors from 'cors'
import fileUpload from 'express-fileupload'
import rateLimit from 'express-rate-limit'
import slowDown from 'express-slow-down'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'path'
import io from 'socket.io'

import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { StorageFile } from '../../storage'
import { getMediaDuration } from '../../utils/media'
import { errorHandler, notFoundHandler, parseAuthUser } from '../middlewares'
import { Request, Response } from '../request'
import { Route, formatPath } from '../routes'
import { StatusCodes } from '../statusCodes'

export class ExpressServer extends Server<express.Request, express.Response> {
	#expressApp: express.Express
	server: http.Server
	listener: Listener

	constructor () {
		super()
		this.#expressApp = express()
		this.#expressApp.disable('x-powered-by')
		this.server = http.createServer(this.#expressApp)
		this.#expressApp.use(morgan((tokens, req, res) =>
			`${tokens.method(req, res)}(${tokens.status(req, res)}) ${tokens.url(req, res)} ${tokens.res(req, res, 'content-length')}b - ${tokens['response-time'](req, res)}ms`
		))
		this.#expressApp.use(express.json())
		this.#expressApp.use(express.text())
		this.#expressApp.use(cookie())
		this.#expressApp.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }))
		this.#expressApp.use(cors({ origin: '*' }))
		this.#expressApp.use(express.urlencoded({ extended: false }))
		this.#expressApp.use(express.static(path.join(process.cwd(), 'public')))
		if (this.settings.useRateLimit) this.#expressApp.use(rateLimit({
			windowMs: this.settings.rateLimitPeriodInMs,
			limit: this.settings.rateLimit,
			handler: (_: express.Request, res: express.Response) => res.status(StatusCodes.TooManyRequests).json([{ message: 'Too Many Requests' }])
		}))
		if (this.settings.useSlowDown) this.#expressApp.use(slowDown({
			windowMs: this.settings.slowDownPeriodInMs,
			delayAfter: this.settings.slowDownAfter,
			delayMs: this.settings.slowDownDelayInMs
		}))
		this.#expressApp.use(
			fileUpload({
				limits: { fileSize: this.settings.maxFileUploadSizeInMb * 1024 * 1024 },
				useTempFiles: false
			}) as any
		)
		const socket = new io.Server(this.server, { cors: { origin: '*' } })
		this.listener = new Listener(socket, {
			onConnect: async () => { },
			onDisconnect: async () => { }
		})
	}

	registerRoute (route: Route) {
		const { method, path, middlewares = [], handler } = route
		const controllers: express.RequestHandler[] = [parseAuthUser, ...middlewares].map((m) => this.makeMiddleware(m))
		this.#expressApp[method]?.(formatPath(path), ...controllers, this.makeController(handler))
	}

	async startServer (port: number) {
		this.#expressApp.use(this.makeMiddleware(notFoundHandler))
		this.#expressApp.use(this.makeErrorMiddleware(errorHandler))

		return await new Promise((resolve: (s: boolean) => void, reject: (e: Error) => void) => {
			try {
				const app = this.server.listen(port, async () => {
					await Instance.get().logger.success(`${this.settings.appId} service listening on port`, port)
					resolve(true)
				})
				addWaitBeforeExit(app.close)
			} catch (err) {
				reject(err as Error)
			}
		})
	}

	async parse (req: express.Request, res: express.Response) {
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
			method: req.method,
			path: req.path,
			headers, files,
			data: {}
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

	makeMiddleware(cb: Defined<Route['middlewares']>[number]) {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				await cb(await this.parse(req, res))
				return next()
			} catch (e) {
				return next(e)
			}
		}
	}

	makeErrorMiddleware(cb: (req: Request, err: Error) => Promise<Response<unknown>>) {
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