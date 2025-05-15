import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request) => {
	const { requestsAuth } = Instance.get().settings
	const { AccessToken, ApiKey } = request.headers
	function errorHandler (err: any) {
		if (err instanceof CustomError) request.pendingError = err
		return null
	}
	if (requestsAuth.tokens && AccessToken)
		request.users.access = await requestsAuth.tokens.verifyAccessToken(AccessToken).catch(errorHandler)
	else if (requestsAuth.apiKey && ApiKey)
		request.users.apiKey = await requestsAuth.apiKey.verifyApiKey(ApiKey).catch(errorHandler)
})
