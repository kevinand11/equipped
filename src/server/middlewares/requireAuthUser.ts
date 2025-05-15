import { NotAuthenticatedError, NotAuthorizedError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const requireAuthUser = makeMiddleware(
	async (request) => {
		if (request.pendingError) throw request.pendingError
		request.authUser = request.users.access || request.users.apiKey
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ AccessToken: [], ApiKey: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid means of authentication.')
	},
)

export const requireAccessTokenUser = makeMiddleware(
	async (request) => {
		if (request.pendingError) throw request.pendingError
		request.authUser = request.users.access
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ AccessToken: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid Access-Token header.')
	},
)

export const requireApiKeyUser = makeMiddleware(
	async (request) => {
		if (request.pendingError) throw request.pendingError
		request.authUser = request.users.apiKey
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ ApiKey: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid Api-Key header.')
	},
)


export const requireRefreshTokenUser = makeMiddleware(
	async (request) => {
		const refreshToken = request.headers.RefreshToken
		if (!refreshToken) throw new NotAuthorizedError('Refresh-Token header missing')
		request.users.refresh = await Instance.get().settings.requestsAuth.tokens?.verifyRefreshToken(refreshToken) ?? null
		if (!request.users.refresh) throw new NotAuthorizedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ RefreshToken: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid Refresh-Token header.')
	},
)