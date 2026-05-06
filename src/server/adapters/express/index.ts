import http from 'http'

import cookie from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fileUpload from 'express-fileupload'
import { rateLimit } from 'express-rate-limit'
// import slowDown from 'express-slow-down'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'

import { Instance } from '../../../instance'
import { configurable, getMediaDuration } from '../../../utilities'
import { Request } from '../../requests'
import { StatusCodes, type IncomingFile } from '../../types'
import { Server, serverConfigPipe } from '../base'

export class ExpressServer extends configurable(serverConfigPipe, Server as unknown as new () => Server) {
	#app: express.Express
	#httpServer: http.Server

	protected constructor(config: typeof ExpressServer.Config) {
		super(config)
		const app = express()
		const instance = Instance.get()
		const httpServer = http.createServer(app)
		this.#app = app
		this.#httpServer = httpServer

		this.setup(httpServer, config)

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

	protected async parseRequest(req: any) {
		const files = Object.fromEntries(
			await Promise.all(
				Object.entries(req.files ?? {}).map(async ([key, file]) => {
					const uploads = Array.isArray(file) ? file : [file]
					const fileArray: IncomingFile[] = await Promise.all(
						uploads.map(async (f: any) => ({
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
	}

	protected async handleResponse(res: any, response: any) {
		if (!response.piped) {
			Object.entries(response.headers).forEach(([key, value]) => res.header(key, value as string))
			Object.entries(response.cookies).forEach(([key, { value, ...opts }]: [string, any]) => res.cookie(key, value, opts))
			const type = response.body === null || response.body === undefined ? 'json' : 'send'
			res.status(response.status)[type](response.body).end()
		} else {
			response.body.pipe(res)
		}
	}

	protected registerRoute(method: any, path: string, cb: (req: any, res: any) => Promise<void>) {
		this.#app[method]?.(path, async (req: any, res: any) => cb(req, res))
	}

	protected registerErrorHandler(cb: (error: Error, req: any, res: any) => Promise<void>) {
		this.#app.use(async (err: any, req: any, res: any, _next: any) => cb(err, req, res))
	}

	protected registerNotFoundHandler(cb: (req: any, res: any) => Promise<void>) {
		this.#app.use(async (req: any, res: any, _next: any) => cb(req, res))
	}

	protected startServer(port: number) {
		return new Promise<boolean>((resolve: (s: boolean) => void, reject: (e: Error) => void) => {
			try {
				const server = this.#httpServer.listen({ host: '0.0.0.0', port }, async () => resolve(true))
				Instance.on('close', server.close, 1)
			} catch (err) {
				reject(<Error>err)
			}
		})
	}
}
