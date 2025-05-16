import { NotAuthenticatedError, NotAuthorizedError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const requireAuthUser = makeMiddleware(
	async (request) => {
		const user = request.users.access.value || request.users.apiKey.value
		const error = request.users.access.error || request.users.apiKey.error
		if (!user && error) throw error
		request.authUser = user
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ Authorization: [] }, { ApiKey: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid means of authentication.')
	},
)

export const requireAuthorizationUser = makeMiddleware(
	async (request) => {
		if (request.users.access.error) throw request.users.access.error
		request.authUser = request.users.access.value
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ Authorization: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid authorization header.')
	},
)

export const requireApiKeyUser = makeMiddleware(
	async (request) => {
		if (request.users.apiKey.error) throw request.users.apiKey.error
		request.authUser = request.users.apiKey.value
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ ApiKey: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid x-api-key header.')
	},
)


export const requireRefreshTokenUser = makeMiddleware(
	async (request) => {
		if (request.users.refresh.error) throw request.users.refresh.error
		const refreshToken = request.headers.RefreshToken
		if (!refreshToken) throw new NotAuthorizedError('x-refresh-token header missing')
		request.users.refresh.value = await Instance.get().settings.requestsAuth.tokens?.verifyRefreshToken(refreshToken)
		if (!request.users.refresh.value) throw new NotAuthorizedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ RefreshToken: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid x-refresh-token header.')
	},
)