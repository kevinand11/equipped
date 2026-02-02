import type { IncomingHttpHeaders } from 'node:http2'

import jwt from 'jsonwebtoken'

import { BaseRequestAuthMethod } from './base'
import { EquippedError, NotAuthenticatedError, TokenExpired } from '../../errors'

interface BaseTokenRequestAuthMethodOptions {
	headerName: string
	tokenKey: string
	tokenTTL: number
	tokenPrefix: string
	stripBearer?: boolean
}

export abstract class BaseTokenRequestAuthMethod<T extends { id: string }> extends BaseRequestAuthMethod<T> {
	readonly #options: BaseTokenRequestAuthMethodOptions
	abstract saveToken(key: string, token: string, ttl: number): Promise<void>
	abstract retrieveToken(key: string): Promise<string | null>
	abstract deleteToken(key: string): Promise<void>

	constructor(options: BaseTokenRequestAuthMethodOptions) {
		super()
		this.#options = options
	}

	#getTokenKey(userId: string) {
		return `${this.#options.tokenPrefix}${userId}`
	}

	#parseTokenValue (headerValue: string) {
		if (!headerValue) throw new NotAuthenticatedError()
		if (!this.#options.stripBearer) return headerValue
		if (!headerValue.startsWith('Bearer ')) throw new EquippedError(`header must begin with 'Bearer '`, { headerValue })
		return headerValue.slice(7)
	}

	async createToken(payload: T) {
		const token = jwt.sign(payload, this.#options.tokenKey, { expiresIn: this.#options.tokenTTL })
		await this.saveToken(this.#getTokenKey(payload.id), token, this.#options.tokenTTL)
		return token
	}

	async parse(headers: IncomingHttpHeaders) {
		try {
			const headerValue = headers[this.#options.headerName]
			if (!headerValue || typeof headerValue !== 'string') throw new NotAuthenticatedError()
			const token = this.#parseTokenValue(headerValue)
			const user = jwt.verify(token, this.#options.tokenKey) as T
			if (!user) throw new NotAuthenticatedError()

			const cachedToken = await this.retrieveToken(this.#getTokenKey(user.id))
			if (token && token !== cachedToken) throw new TokenExpired()

			return user
		} catch (err) {
			if (err instanceof TokenExpired) throw err
			if (err instanceof jwt.TokenExpiredError) throw new TokenExpired(undefined, err)
			else throw new NotAuthenticatedError(undefined, err)
		}
	}
}
