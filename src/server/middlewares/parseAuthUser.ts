import { BadRequestError, RequestError } from '../../errors'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request, config) => {
	if (!config.requestsAuth) return
	const { Authorization, ApiKey } = request.headers
	function makeErrorHandler(key: 'access' | 'apiKey') {
		return function (err: any) {
			request.users[key].error = err instanceof RequestError ? err : new BadRequestError('failed to parse auth user', err)
			request.users[key].error.context[key] = key
			return undefined
		}
	}
	if (config.requestsAuth.tokens && Authorization)
		request.users.access.value = await config.requestsAuth.tokens.verifyToken(Authorization).catch(makeErrorHandler('access'))
	else if (config.requestsAuth.apiKey && ApiKey)
		request.users.apiKey.value = await config.requestsAuth.apiKey.verifyApiKey(ApiKey).catch(makeErrorHandler('apiKey'))
})
