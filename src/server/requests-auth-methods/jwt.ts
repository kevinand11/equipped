import type { IncomingHttpHeaders } from 'node:http2'

import cookie from '@fastify/cookie'
import jwt from 'jsonwebtoken'

import { BaseRequestAuthMethod } from './base'
import { EquippedError, NotAuthenticatedError, TokenExpired } from '../../errors'

export interface BaseJwtRequestAuthMethodOptions {
	signingKey: string
	storageTTL: number
	storagePrefix?: string
}

export abstract class BaseJwtRequestAuthMethod<T extends { id: string }> extends BaseRequestAuthMethod<T> {
	readonly #options: BaseJwtRequestAuthMethodOptions
	abstract parseHeader(headers: IncomingHttpHeaders): Promise<string>
	abstract store(key: string, token: string, ttl: number): Promise<void>
	abstract retrieve(key: string): Promise<string | null>
	abstract delete(key: string): Promise<void>

	constructor(options: BaseJwtRequestAuthMethodOptions) {
		super()
		this.#options = options
	}

	#getKey(userId: string) {
		return `${this.#options.storagePrefix ?? ''}${userId}`
	}

	async createToken(payload: T) {
		const token = jwt.sign(payload, this.#options.signingKey, { expiresIn: this.#options.storageTTL })
		await this.store(this.#getKey(payload.id), token, this.#options.storageTTL)
		return token
	}

	async parse(headers: IncomingHttpHeaders) {
		try {
			const token = await this.parseHeader(headers)
			const user = jwt.verify(token, this.#options.signingKey) as T
			if (!user) throw new NotAuthenticatedError()

			const cachedToken = await this.retrieve(this.#getKey(user.id))
			if (token && token !== cachedToken) throw new TokenExpired()

			return user
		} catch (err) {
			if (err instanceof TokenExpired) throw err
			if (err instanceof jwt.TokenExpiredError) throw new TokenExpired(undefined, err)
			else throw new NotAuthenticatedError(undefined, err)
		}
	}
}

interface BaseJwtHeaderRequestAuthMethodOptions extends BaseJwtRequestAuthMethodOptions {
	headerName: string
	stripBearer?: boolean
}

export abstract class BaseJwtHeaderRequestAuthMethod<T extends { id: string }> extends BaseJwtRequestAuthMethod<T> {
	readonly #options: BaseJwtHeaderRequestAuthMethodOptions

	constructor(options: BaseJwtHeaderRequestAuthMethodOptions) {
		super(options)
		this.#options = options
	}

	async parseHeader(headers: IncomingHttpHeaders) {
		const value = headers[this.#options.headerName]
		if (!value || typeof value !== 'string') throw new NotAuthenticatedError()
		if (!this.#options.stripBearer) return value
		if (!value.startsWith('Bearer ')) throw new EquippedError(`header must begin with 'Bearer '`, { headerValue: value })
		return value.slice(7)
	}

	routeSecuritySchemeName() {
		return this.#options.headerName
	}
}

interface BaseJwtCookieRequestAuthMethodOptions extends BaseJwtRequestAuthMethodOptions {
	cookieName: string
}

export abstract class BaseJwtCookieRequestAuthMethod<T extends { id: string }> extends BaseJwtRequestAuthMethod<T> {
	readonly #options: BaseJwtCookieRequestAuthMethodOptions

	constructor(options: BaseJwtCookieRequestAuthMethodOptions) {
		super(options)
		this.#options = options
	}

	async parseHeader(headers: IncomingHttpHeaders) {
		const cookies = cookie.parse(headers.cookie || '') ?? {}
		const value = cookies[this.#options.cookieName]
		if (!value || typeof value !== 'string') throw new NotAuthenticatedError()
		return value
	}

	routeSecuritySchemeName() {
		return `cookie:${this.#options.cookieName}`
	}
}
