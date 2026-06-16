import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyFormBody from '@fastify/formbody'
import fastifyHelmet from '@fastify/helmet'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
// import fastifySlowDown from 'fastify-slow-down'
import qs from 'qs'

import { ValidationError } from '../../../errors'
import { Instance } from '../../../instance'
import { configurable, getMediaDuration } from '../../../utilities'
import { Request, Response } from '../../requests'
import { StatusCodes, type IncomingFile, type MethodsEnum } from '../../types'
import { Server, serverConfigPipe } from '../base'

export class FastifyServer extends configurable(serverConfigPipe, Server) {
	#app: ReturnType<typeof Fastify>

	protected constructor(config: typeof FastifyServer.Config) {
		super(config)
		const instance = Instance.get()
		const app = Fastify({
			disableRequestLogging: !config.requests.log,
			loggerInstance: config.requests.log ? instance.log : undefined,
			ajv: { customOptions: { coerceTypes: false } },
			routerOptions: {
				ignoreTrailingSlash: true,
				caseSensitive: false,
			},
			schemaErrorFormatter: (errors, data) =>
				new ValidationError(
					errors.map((error) => ({
						messages: [error.message ?? ''],
						field: `${data}${error.instancePath}`.replaceAll('/', '.'),
					})),
				),
		})
		this.#app = app

		this.setup(app.server, config)

		app.decorateRequest('savedReq', null)
		app.setValidatorCompiler(() => () => true)
		app.setSerializerCompiler(() => (data) => JSON.stringify(data))
		if (config.publicPath) app.register(fastifyStatic, { root: config.publicPath })
		app.register(fastifyCookie, {})
		app.register(fastifyCors, this.cors)
		app.register(fastifyFormBody, { parser: (str) => qs.parse(str) })
		app.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false })
		app.register(fastifyMultipart, {
			attachFieldsToBody: 'keyValues',
			throwFileSizeLimit: false,
			limits: { fileSize: instance.settings.utils.maxFileUploadSizeInMb * 1024 * 1024 },
			onFile: async (f) => {
				const buffer = await f.toBuffer()
				const parsed: IncomingFile = {
					name: f.filename,
					type: f.mimetype,
					size: buffer.byteLength,
					isTruncated: f.file.truncated,
					data: buffer,
					duration: await getMediaDuration(buffer),
				}
				// @ts-ignore
				f.value = parsed
			},
		})
		/* if (this.settings.slowdown.enabled) app.register(fastifySlowDown, {
				timeWindow: this.settings.slowdown.periodInMs,
				delayAfter: this.settings.slowdown.delayAfter,
				delay: this.settings.slowdown.delayInMs
			}) */
		if (config.requests.rateLimit.enabled)
			app.register(fastifyRateLimit, {
				max: config.requests.rateLimit.limit,
				timeWindow: config.requests.rateLimit.periodInMs,
				errorResponseBuilder: (_, context) => ({
					statusCode: StatusCodes.TooManyRequests,
					message: JSON.stringify([{ message: `Too Many Requests. Retry in ${context.after}` }]),
				}),
			})
	}

	protected async parseRequest(req: any) {
		const { body, files } = excludeBufferKeys(req.body ?? {})

		return new Request({
			ip: req.ip,
			body,
			cookies: req.cookies ?? {},
			params: req.params ?? <any>{},
			query: req.query ?? {},
			method: <any>req.method,
			path: req.url,
			headers: req.headers,
			files,
		})
	}

	protected async handleResponse(res: any, response: Response<any>) {
		for (const [key, { value, ...opts }] of Object.entries(response.cookies)) res = res.setCookie(key, value, opts)
		await res.status(response.status).headers(response.headers).send(response.body)
	}

	protected registerRoute(method: MethodsEnum, path: string, cb: (req: any, res: any) => Promise<void>) {
		this.#app.register(async (inst) => {
			inst.route({ url: path, method, handler: cb })
		})
	}

	protected registerErrorHandler(cb: (error: Error, req: any, res: any) => Promise<void>) {
		this.#app.setErrorHandler(cb)
	}

	protected registerNotFoundHandler(cb: (req: any, res: any) => Promise<void>) {
		this.#app.setNotFoundHandler(cb)
	}

	protected async startServer(port: number) {
		await this.#app.ready()
		await this.#app.listen({ port, host: '0.0.0.0' })
		Instance.on('close', this.#app.close)
		return true
	}
}

function excludeBufferKeys<T>(body: T) {
	if (typeof body !== 'object') return { body, files: {} }
	const entries = Object.entries(body ?? {})
	const isFile = (val: any) => (Array.isArray(val) ? isFile(val.at(0)) : Buffer.isBuffer(val?.data))
	const fileEntries = entries.filter(([_, value]) => isFile(value)).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
	const nonFileEntries = entries.filter(([_, value]) => !isFile(value))
	return {
		body: <T>Object.fromEntries(nonFileEntries),
		files: <Record<string, IncomingFile[]>>Object.fromEntries(fileEntries),
	}
}
