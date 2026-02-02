import jwt from 'jsonwebtoken'

import type { Cache } from '../../cache'
import { EquippedError, NotAuthenticatedError, TokenExpired } from '../../errors'

interface BaseTokensUtilityOptions {
	tokenKey: string
	tokenTTL: number
	tokenPrefix: string
	checkCacheOnVerify?: boolean
	stripBearer?: boolean
}

type UserPayload = { id: string }

export abstract class BaseTokensUtility<T extends UserPayload> {
	#options: BaseTokensUtilityOptions
	abstract saveToken(key: string, token: string, ttl: number): Promise<void>
	abstract retrieveToken(key: string): Promise<string | null>
	abstract deleteToken(key: string): Promise<void>

	constructor(options: BaseTokensUtilityOptions) {
		this.#options = options
	}

	#getTokenKey(userId: string) {
		return `${this.#options.tokenPrefix}${userId}`
	}

	#parseTokenValue(headerValue: string) {
		if (!this.#options.stripBearer) return headerValue
		if (!headerValue.startsWith('Bearer ')) throw new EquippedError(`header must begin with 'Bearer '`, { headerValue })
		return headerValue.slice(7)
	}

	async createToken(payload: T) {
		const token = jwt.sign(payload, this.#options.tokenKey, { expiresIn: this.#options.tokenTTL })
		await this.saveToken(this.#getTokenKey(payload.id), token, this.#options.tokenTTL)
		return token
	}

	async verifyToken(headerValue: string) {
		try {
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

export class CacheTokensUtility<T extends UserPayload> extends BaseTokensUtility<T> {
	stripBearer: boolean
	constructor(
		options: BaseTokensUtilityOptions,
		private cache: () => Cache,
	) {
		super(options)
		this.stripBearer = options.stripBearer ?? true
	}

	async saveToken(key: string, token: string, ttl: number): Promise<void> {
		await this.cache().set(key, token, ttl)
	}

	async retrieveToken(key: string) {
		return this.cache().get(key)
	}

	async deleteToken(key: string) {
		await this.cache().delete(key)
	}
}
