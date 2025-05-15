import { NotAuthorizedError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const requireRefreshUser = makeMiddleware(
	async (request) => {
		const refreshToken = request.headers.RefreshToken
		if (!refreshToken) throw new NotAuthorizedError('Refresh-Token header missing')
		request.refreshUser = await Instance.get().settings.requestsAuth.tokens?.verifyRefreshToken(refreshToken) ?? null
		if (!request.refreshUser) throw new NotAuthorizedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ RefreshToken: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid Refresh-Token header.')
	},
)
