import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyFormBody from '@fastify/formbody'
import fastifyHelmet from '@fastify/helmet'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler, RouteHandlerMethod } from 'fastify'
import fastifySlowDown from 'fastify-slow-down'

import http from 'http'
import { Listener } from '../../listeners'
import { Defined, Server } from './base'

import path from 'path'
import io from 'socket.io'

import qs from 'qs'
import { addWaitBeforeExit } from '../../exit'
import { Instance } from '../../instance'
import { StorageFile } from '../../storage'
import { getMediaDuration } from '../../utils/media'
import { errorHandler, notFoundHandler, parseAuthUser } from '../middlewares'
import { Request, Response } from '../request'
import { formatPath, Route } from '../routes'
import { StatusCodes } from '../statusCodes'

export class FastifyServer extends Server<FastifyRequest, FastifyReply> {
	#fastifyApp: FastifyInstance
	server: http.Server
	listener: Listener

	constructor () {
		super()

		this.#fastifyApp = Fastify({
			logger: false,
		})
		this.server = this.#fastifyApp.server

		this.#fastifyApp.decorateRequest('savedReq', null)

		this.#fastifyApp.register(fastifyStatic, { root: path.join(process.cwd(), 'public') })
		this.#fastifyApp.register(fastifyCookie, {})
		this.#fastifyApp.register(fastifyCors, { origin: '*' })
		this.#fastifyApp.register(fastifyMultipart, {
			limits: { fileSize: this.settings.maxFileUploadSizeInMb * 1024 * 1024 }
		})
		this.#fastifyApp.register(fastifyFormBody, { parser: (str) => qs.parse(str) })
		this.#fastifyApp.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } })
		if (this.settings.useSlowDown) this.#fastifyApp.register(fastifySlowDown, {
			timeWindow: this.settings.slowDownPeriodInMs,
			delayAfter: this.settings.slowDownAfter,
			delay: this.settings.slowDownDelayInMs
		})
		if (this.settings.useRateLimit) this.#fastifyApp.register(fastifyRateLimit, {
			max: this.settings.rateLimit,
			timeWindow: this.settings.rateLimitPeriodInMs,
			errorResponseBuilder: (_, context) => ({
				statusCode: StatusCodes.TooManyRequests,
				message: JSON.stringify([{ message: `Too Many Requests. Retry in ${context.after}` }])
			})
		})

		const socket = new io.Server(this.#fastifyApp.server, { cors: { origin: '*' } })
		this.listener = new Listener(socket, {
			onConnect: async () => { },
			onDisconnect: async () => { }
		})
	}

	registerRoute (route: Route): void {
		const { method, path, middlewares = [], handler } = route
		const controllers = [parseAuthUser, ...middlewares].map(this.makeMiddleware)
		this.#fastifyApp[method](formatPath(path), {
			handler: this.makeController(handler),
			preHandler: controllers
		})
	}

	async startServer (port: number) {
		this.#fastifyApp.setNotFoundHandler(this.makeController(notFoundHandler))
		this.#fastifyApp.setErrorHandler(this.makeErrorMiddleware(errorHandler))

		await this.#fastifyApp.listen({ port })
		await Instance.get().logger.success(`${Instance.get().settings.appId} service listening on port`, port)
		addWaitBeforeExit(this.#fastifyApp.close)
		return true
	}

	async make (req: FastifyRequest, res: FastifyReply) {
		const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
		const headers = {
			...allHeaders,
			AccessToken: req.headers['Access-Token']?.toString() ?? null,
			RefreshToken: req.headers['Refresh-Token']?.toString() ?? null,
			ContentType: req.headers['Content-Type']?.toString() ?? null,
			Referer: req.headers['referer']?.toString() ?? null,
			UserAgent: req.headers['User-Agent']?.toString() ?? null
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
						duration: await getMediaDuration(f.data)
					})))
					return [key, fileArray] as const
				})
			)
		)

		return req.savedReq ||= new Request({
			ip: req.ip,
			body: req.body ?? {},
			cookies: req.cookies ?? {},
			params: req.params ?? {},
			query: req.query ?? {},
			method: req.method,
			path: req.routeOptions.url ?? '',
			headers,
			files,
			data: {}
		}, res.raw)
	}

	makeController(cb: Defined<Route['handler']>) {
		const handler: RouteHandlerMethod = async (req, reply) => {
			const rawResponse = await cb(await this.make(req, reply))
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse })
			const type = response.shouldJSONify ? 'json' : 'send'
			if (!response.piped) reply.status(response.status).headers(response.headers)[type](response.body)
		}
		return handler
	}

	makeMiddleware(cb: Defined<Route['middlewares']>[number]) {
		const handler: preHandlerHookHandler = async (req, reply) => {
			await cb(await this.make(req, reply))
		}
		return handler
	}

	makeErrorMiddleware(cb: (req: Request, err: Error) => Promise<Response<unknown>>) {
		const handler: Parameters<FastifyInstance['setErrorHandler']>[0] = async (error, req, reply)=> {
			const rawResponse = await cb(await this.make(req, reply), error)
			const response = rawResponse instanceof Response ? rawResponse : new Response({ body: rawResponse, status: StatusCodes.BadRequest })
			if (!response.piped) reply.status(response.status).headers(response.headers).send(response.body)
		}
		return handler
	}
}

declare module 'fastify' {
  interface FastifyRequest {
    savedReq: Request | null
  }
}