import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request) => {
	const { requestsAuth } = Instance.get().settings
	const { AccessToken, ApiKey } = request.headers
	function makeErrorHandler (key: 'access' | 'apiKey') {
		return function (err: any) {
			if (err instanceof CustomError) request.users[key].error = err
			return undefined
		}
	}
	if (requestsAuth.tokens && AccessToken)
		request.users.access.value = await requestsAuth.tokens.verifyAccessToken(AccessToken).catch(makeErrorHandler('access'))
	else if (requestsAuth.apiKey && ApiKey)
		request.users.apiKey.value = await requestsAuth.apiKey.verifyApiKey(ApiKey).catch(makeErrorHandler('apiKey'))
})
