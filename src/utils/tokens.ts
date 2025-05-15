import jwt from 'jsonwebtoken'

import type { CustomError } from '../errors'
import { AccessTokenExpired, NotAuthenticatedError } from '../errors'
import { Instance } from '../instance'
import { StatusCodes } from '../server'
import type { AuthUser, RefreshUser } from './authUser'

const getAccessTokenKey = (userId: string) => `${userId}-access-token`
const getRefreshTokenKey = (userId: string) => `${userId}-refresh-token`

export const makeAccessToken = async (payload: AuthUser) => {
	const token = jwt.sign(payload, Instance.get().settings.requestsAuth.accessToken.key, { expiresIn: Instance.get().settings.requestsAuth.accessToken.ttl })
	await Instance.get().cache.set(getAccessTokenKey(payload.id), token, Instance.get().settings.requestsAuth.accessToken.ttl)
	return token
}
export const makeRefreshToken = async (payload: RefreshUser) => {
	const token = jwt.sign(payload, Instance.get().settings.requestsAuth.refreshToken.key, { expiresIn: Instance.get().settings.requestsAuth.refreshToken.ttl })
	await Instance.get().cache.set(getRefreshTokenKey(payload.id), token, Instance.get().settings.requestsAuth.refreshToken.ttl)
	return token
}

export const verifyAccessToken = async (token: string) => {
	try {
		const user = jwt.verify(token, Instance.get().settings.requestsAuth.accessToken.key) as AuthUser
		if (!user) throw new NotAuthenticatedError()
		const cachedToken = await getCachedAccessToken(user.id)
		// Cached access token was deleted, e.g. by user roles being modified, so token needs to be treated as expired
		if (token && token !== cachedToken) throw new AccessTokenExpired()
		return user
	} catch (err) {
		if (err instanceof AccessTokenExpired) throw err
		if (err instanceof jwt.TokenExpiredError) throw new AccessTokenExpired()
		else throw new NotAuthenticatedError()
	}
}

export const verifyRefreshToken = async (token: string) => {
	try {
		const user = jwt.verify(token, Instance.get().settings.requestsAuth.refreshToken.key) as RefreshUser
		if (!user) throw new NotAuthenticatedError()
		return user
	} catch {
		throw new NotAuthenticatedError()
	}
}

export const getCachedAccessToken = async (userId: string) => Instance.get().cache.get(getAccessTokenKey(userId))
export const getCachedRefreshToken = async (userId: string) => Instance.get().cache.get(getRefreshTokenKey(userId))
export const deleteCachedAccessToken = async (userId: string) => Instance.get().cache.delete(getAccessTokenKey(userId))
export const deleteCachedRefreshToken = async (userId: string) => Instance.get().cache.delete(getRefreshTokenKey(userId))

type Tokens = {
	accessToken: string
	refreshToken: string
}

export const exchangeOldForNewTokens = async (
	{ accessToken, refreshToken }: Tokens,
	makeTokens: (id: string) => Promise<Tokens>,
): Promise<Tokens> => {
	const authUser = await verifyAccessToken(accessToken).catch((err) => {
		const error = err as CustomError
		if (error.statusCode === StatusCodes.AccessTokenExpired) return null
		else throw err
	})
	// If auth token is not expired, get the user id from it
	if (authUser) return await makeTokens(authUser.id)

	const refreshUser = await verifyRefreshToken(refreshToken)
	// const cachedRefreshToken = await getCachedRefreshToken(refreshUser.id)

	// If no cached value, means someone used your old token for a second time, so current one got deleted from cache
	// if (!cachedRefreshToken) throw new NotAuthenticatedError()

	// If cached value is not equal, means someone is trying to use an old token for a second time
	// if (refreshToken !== cachedRefreshToken) {
	// await deleteCachedAccessToken(refreshUser.id)
	// await deleteCachedRefreshToken(refreshUser.id)
	// throw new RefreshTokenMisusedError()
	// }

	return await makeTokens(refreshUser.id)
}
