import jwt from 'jsonwebtoken'

import type { Cache } from '../../cache'
import type { RequestError } from '../../errors'
import { AuthorizationExpired, EquippedError, NotAuthenticatedError } from '../../errors'
import type { AuthUser, RefreshUser } from '../../types'
import { StatusCodes } from '../types'

export abstract class BaseTokensUtility {
	abstract createAccessToken(payload: AuthUser): Promise<string>
	abstract createRefreshToken(payload: RefreshUser): Promise<string>
	abstract verifyAccessToken(token: string): Promise<AuthUser>
	abstract verifyRefreshToken(token: string): Promise<RefreshUser>
	abstract retrieveAccessTokenFor(userId: string): Promise<string | null>
	abstract retrieveRefreshTokenFor(userId: string): Promise<string | null>
	abstract deleteAccessTokenFor(userId: string): Promise<void>
	abstract deleteRefreshTokenFor(userId: string): Promise<void>

	extractAccessTokenValue(headerValue: string) {
		if (!headerValue.startsWith('Bearer ')) throw new EquippedError(`authorization header must begin with 'Bearer '`, { headerValue })
		return headerValue.slice(7)
	}

	async exchangeTokens(
		tokens: {
			accessToken: string
			refreshToken: string
		},
		getPayload: (id: string) => Promise<{ access: AuthUser; refresh: RefreshUser }>,
	): Promise<{
		accessToken: string
		refreshToken: string
	}> {
		const authUser = await this.verifyAccessToken(tokens.accessToken).catch((err) => {
			const error = err as RequestError
			if (error.statusCode === StatusCodes.AuthorizationExpired) return null
			else throw err
		})
		if (authUser) return tokens

		const refreshUser = await this.verifyRefreshToken(tokens.refreshToken)
		// const cachedRefreshToken = await getCachedRefreshToken(refreshUser.id)

		// If no cached value, means someone used your old token for a second time, so current one got deleted from cache
		// if (!cachedRefreshToken) throw new NotAuthenticatedError()

		// If cached value is not equal, means someone is trying to use an old token for a second time
		// if (refreshToken !== cachedRefreshToken) {
		// await deleteCachedAccessToken(refreshUser.id)
		// await deleteCachedRefreshToken(refreshUser.id)
		// throw new RefreshTokenMisusedError()
		// }

		const payloads = await getPayload(refreshUser.id)
		return {
			accessToken: await this.createAccessToken(payloads.access),
			refreshToken: await this.createRefreshToken(payloads.refresh),
		}
	}
}

type CacheTokensUtilityOptions = {
	cache: () => Cache
	accessTokenKey?: string
	refreshTokenKey?: string
	accessTokenTTL?: number
	refreshTokenTTL?: number
	accessTokenPrefix?: string
	refreshTokenPrefix?: string
}

export class CacheTokensUtility extends BaseTokensUtility {
	#getAccessTokenKey: (userId: string) => string
	#getRefreshTokenKey: (userId: string) => string
	private options: Required<CacheTokensUtilityOptions>
	constructor(options: CacheTokensUtilityOptions) {
		super()
		this.options = {
			accessTokenKey: 'accessTokenKey',
			refreshTokenKey: 'refreshTokenKey',
			accessTokenTTL: 60 * 60,
			refreshTokenTTL: 14 * 24 * 60 * 60,
			accessTokenPrefix: 'tokens:access:',
			refreshTokenPrefix: 'tokens:refresh:',
			...options,
		}
		this.#getAccessTokenKey = (userId: string) => `${this.options.accessTokenPrefix}${userId}`
		this.#getRefreshTokenKey = (userId: string) => `${this.options.refreshTokenPrefix}${userId}`
	}

	async createAccessToken(payload: AuthUser) {
		const token = jwt.sign(payload, this.options.accessTokenKey, { expiresIn: this.options.accessTokenTTL })
		await this.options.cache().set(this.#getAccessTokenKey(payload.id), token, this.options.accessTokenTTL)
		return token
	}

	async createRefreshToken(payload: RefreshUser) {
		const token = jwt.sign(payload, this.options.refreshTokenKey, { expiresIn: this.options.refreshTokenTTL })
		await this.options.cache().set(this.#getRefreshTokenKey(payload.id), token, this.options.refreshTokenTTL)
		return token
	}

	async verifyAccessToken(authHeader: string) {
		try {
			const accessToken = this.extractAccessTokenValue(authHeader)
			const user = jwt.verify(accessToken, this.options.accessTokenKey) as AuthUser
			if (!user) throw new NotAuthenticatedError()
			const cachedToken = await this.retrieveAccessTokenFor(user.id)
			// Cached access token was deleted, e.g. by user roles being modified, so token needs to be treated as expired
			if (accessToken && accessToken !== cachedToken) throw new AuthorizationExpired()
			return user
		} catch (err) {
			if (err instanceof AuthorizationExpired) throw err
			if (err instanceof jwt.TokenExpiredError) throw new AuthorizationExpired(undefined, err)
			else throw new NotAuthenticatedError(undefined, err)
		}
	}

	async verifyRefreshToken(token: string) {
		try {
			const user = jwt.verify(token, this.options.refreshTokenKey) as RefreshUser
			if (!user) throw new NotAuthenticatedError()
			return user
		} catch (err) {
			throw new NotAuthenticatedError(undefined, err)
		}
	}

	async retrieveAccessTokenFor(userId: string) {
		return this.options.cache().get(this.#getAccessTokenKey(userId))
	}

	async retrieveRefreshTokenFor(userId: string) {
		return this.options.cache().get(this.#getRefreshTokenKey(userId))
	}

	async deleteAccessTokenFor(userId: string) {
		await this.options.cache().delete(this.#getAccessTokenKey(userId))
	}

	async deleteRefreshTokenFor(userId: string) {
		await this.options.cache().delete(this.#getRefreshTokenKey(userId))
	}
}
