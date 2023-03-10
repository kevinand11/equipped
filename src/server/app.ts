import cookie from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fileUpload from 'express-fileupload'
import rateLimit from 'express-rate-limit'
import slowDown from 'express-slow-down'
import helmet from 'helmet'
import http from 'http'
import morgan from 'morgan'
import path from 'path'
import io from 'socket.io'
import supertest from 'supertest'
import { addWaitBeforeExit } from '../exit'
import { Instance } from '../instance'
import { Listener } from '../listeners'
import { parseAuthUser } from './middlewares/parseAuthUser'
import { PostRoutes, Route } from './routes'
import { StatusCodes } from './statusCodes'

export class Server {
	#expressApp: express.Express
	#httpServer: http.Server<any, any>
	#listener: Listener

	constructor () {
		const settings = Instance.get().settings
		this.#expressApp = express()
		this.#expressApp.disable('x-powered-by')
		this.#httpServer = http.createServer(this.#expressApp)
		if (settings.isDev) this.#expressApp.use(morgan('dev'))
		this.#expressApp.use(express.json())
		this.#expressApp.use(cookie())
		this.#expressApp.use(helmet())
		this.#expressApp.use(cors({ origin: '*' }))
		this.#expressApp.use(express.urlencoded({ extended: false }))
		this.#expressApp.use(express.static(path.join(process.cwd(), 'public')))
		if (settings.useRateLimit) this.#expressApp.use(rateLimit({
			windowMs: settings.rateLimitPeriodInMs,
			max: settings.rateLimit,
			handler: (_: express.Request, res: express.Response) => res.status(StatusCodes.TooManyRequests).json([{ message: 'Too Many Requests' }])
		}))
		if (settings.useSlowDown) this.#expressApp.use(slowDown({
			windowMs: settings.slowDownPeriodInMs,
			delayAfter: settings.slowDownAfter,
			delayMs: settings.slowDownDelayInMs
		}))
		this.#expressApp.use(
			fileUpload({
				limits: { fileSize: settings.maxFileUploadSizeInMb * 1024 * 1024 },
				useTempFiles: false
			}) as any
		)
		const socket = new io.Server(this.#httpServer, { cors: { origin: '*' } })
		this.#listener = new Listener(socket, {
			onConnect: async () => { },
			onDisconnect: async () => { }
		})
	}

	get listener () {
		return this.#listener
	}

	set routes (routes: Route[]) {
		const allRoutes = [...routes, ...PostRoutes()]
		allRoutes.forEach(({ method, path, controllers }) => {
			controllers = [parseAuthUser, ...controllers]
			if (path) this.#expressApp[method]?.(formatPath(path), ...controllers)
			else this.#expressApp.use(...controllers)
		})
	}

	test () {
		return supertest(this.#httpServer)
	}

	async start (port: number) {
		return await new Promise((resolve: (s: boolean) => void, reject: (e: Error) => void) => {
			try {
				const app = this.#httpServer.listen(port, async () => {
					await Instance.get().logger.success(`${Instance.get().settings.appId} service listening on port`, port)
					resolve(true)
				})
				addWaitBeforeExit(app.close)
			} catch (err) {
				reject(err as Error)
			}
		})
	}
}

const formatPath = (path: string) => `/${path}/`
	.replaceAll('///', '/')
	.replaceAll('//', '/')