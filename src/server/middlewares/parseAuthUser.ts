import { BaseRequestAuthMethod } from '../requests-auth-methods'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request, config) => {
	await BaseRequestAuthMethod.process(config.requestsAuthMethods, request.headers)
		.then((user) => {
			request.authUser = user
		})
		.catch((err) => {
			request.authUserError = err
		})
})
