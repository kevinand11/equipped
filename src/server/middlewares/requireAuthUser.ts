import { NotAuthenticatedError } from '../../errors'
import { makeMiddleware } from '../routes'

export const requireAuthUser = makeMiddleware(async (request) => {
	if (request.pendingError) throw request.pendingError
	if (!request.authUser) throw new NotAuthenticatedError('Access-Token header missing')
}, (route) => {
	route.security ??= []
	route.security.push({ AccessToken: [] })
})