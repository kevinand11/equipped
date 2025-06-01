import { BadRequestError, RequestError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request) => {
	const { requestsAuth } = Instance.get().settings
	const { Authorization, ApiKey } = request.headers
	function makeErrorHandler(key: 'access' | 'apiKey') {
		return function (err: any) {
			request.users[key].error = err instanceof RequestError ? err : new BadRequestError('failed to parse auth user', err)
			request.users[key].error.context[key] = key
			return undefined
		}
	}
	if (requestsAuth.tokens && Authorization)
		request.users.access.value = await requestsAuth.tokens.verifyAccessToken(Authorization).catch(makeErrorHandler('access'))
	else if (requestsAuth.apiKey && ApiKey)
		request.users.apiKey.value = await requestsAuth.apiKey.verifyApiKey(ApiKey).catch(makeErrorHandler('apiKey'))
})
