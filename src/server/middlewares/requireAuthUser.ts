import { NotAuthenticatedError } from '../../errors'
import { makeMiddleware } from '../types'

export const requireAuthUser = makeMiddleware(
	async (request) => {
		if (request.pendingError) throw request.pendingError
		if (!request.authUser) throw new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ AccessToken: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid means of authentication.')
	},
)
