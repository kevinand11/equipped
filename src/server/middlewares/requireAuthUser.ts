import { NotAuthenticatedError } from '../../errors'
import { makeMiddleware } from '../types'

export const requireAuthUser = makeMiddleware(
	async (request) => {
		if (!request.authUser) throw request.authUserError ?? new NotAuthenticatedError()
	},
	(route) => {
		route.security ??= []
		route.security.push({ Authorization: [] }, { ApiKey: [] })
		route.descriptions ??= []
		route.descriptions.push('Requires a valid means of authentication.')
	},
)
