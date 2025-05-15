import jwt from 'jsonwebtoken'

import type { CustomError } from '../errors'
import { AccessTokenExpired, NotAuthenticatedError } from '../errors'
import { Instance } from '../instance'
import { StatusCodes } from '../server'
import type { AuthUser, RefreshUser } from './types'


export abstract class BaseTokensUtility {
	abstract createAccessToken(payload: AuthUser) :Promise<string>
	abstract createRefreshToken(payload: RefreshUser) :Promise<string>
	abstract verifyAccessToken(token: string) :Promise<AuthUser>
	abstract verifyRefreshToken (token: string): Promise<RefreshUser>
	abstract retrieveAccessTokenFor(userId: string) :Promise<string | null>
	abstract retrieveRefreshTokenFor(userId: string) :Promise<string | null>
	abstract deleteAccessTokenFor(userId: string) :Promise<void>
	abstract deleteRefreshTokenFor(userId: string) :Promise<void>

	async exchangeTokens (tokens: {
		accessToken: string
		refreshToken: string
	}, getPayload: (id: string) => Promise<{ access: AuthUser; refresh: RefreshUser }>): Promise<{
		accessToken: string
		refreshToken: string
	}> {
		const authUser = await this.verifyAccessToken(tokens.accessToken).catch((err) => {
			const error = err as CustomError
			if (error.statusCode === StatusCodes.AccessTokenExpired) return null
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

export class CacheTokensUtility extends BaseTokensUtility {
	#getAccessTokenKey: (userId: string) => string
	#getRefreshTokenKey: (userId: string) => string
	constructor (options: { accessTokenPrefix?: string, refreshTokenPrefix?: string } = {}) {
		super()
		const accessPrefix = options?.accessTokenPrefix ?? 'tokens.access.'
		const refreshPrefix = options?.accessTokenPrefix ?? 'tokens.refresh.'
		this.#getAccessTokenKey = (userId: string) => `${accessPrefix}${userId}`
		this.#getRefreshTokenKey = (userId: string) => `${refreshPrefix}${userId}`
	}

	async createAccessToken (payload: AuthUser) {
		const token = jwt.sign(payload, Instance.get().settings.requestsAuth.accessToken.key, { expiresIn: Instance.get().settings.requestsAuth.accessToken.ttl })
		await Instance.get().cache.set(this.#getAccessTokenKey(payload.id), token, Instance.get().settings.requestsAuth.accessToken.ttl)
		return token
	}

	async createRefreshToken (payload: RefreshUser) {
		const token = jwt.sign(payload, Instance.get().settings.requestsAuth.refreshToken.key, { expiresIn: Instance.get().settings.requestsAuth.refreshToken.ttl })
		await Instance.get().cache.set(this.#getRefreshTokenKey(payload.id), token, Instance.get().settings.requestsAuth.refreshToken.ttl)
		return token
	}

	async verifyAccessToken (token: string) {
		try {
			const user = jwt.verify(token, Instance.get().settings.requestsAuth.accessToken.key) as AuthUser
			if (!user) throw new NotAuthenticatedError()
			const cachedToken = await this.retrieveAccessTokenFor(user.id)
			// Cached access token was deleted, e.g. by user roles being modified, so token needs to be treated as expired
			if (token && token !== cachedToken) throw new AccessTokenExpired()
			return user
		} catch (err) {
			if (err instanceof AccessTokenExpired) throw err
			if (err instanceof jwt.TokenExpiredError) throw new AccessTokenExpired()
			else throw new NotAuthenticatedError()
		}
	}

	async verifyRefreshToken (token: string) {
		try {
			const user = jwt.verify(token, Instance.get().settings.requestsAuth.refreshToken.key) as RefreshUser
			if (!user) throw new NotAuthenticatedError()
			return user
		} catch {
			throw new NotAuthenticatedError()
		}
	}

	async retrieveAccessTokenFor (userId: string) {
		return Instance.get().cache.get(this.#getAccessTokenKey(userId))
	}

	async retrieveRefreshTokenFor (userId: string) {
		return Instance.get().cache.get(this.#getRefreshTokenKey(userId))
	}

	async deleteAccessTokenFor (userId: string) {
		await Instance.get().cache.delete(this.#getAccessTokenKey(userId))
	}

	async deleteRefreshTokenFor (userId: string) {
		await Instance.get().cache.delete(this.#getRefreshTokenKey(userId))
	}
}
