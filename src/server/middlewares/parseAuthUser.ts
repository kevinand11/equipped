import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request) => {
	const { requestsAuth } = Instance.get().settings
	const { AccessToken, ApiKey } = request.headers
	if (requestsAuth.tokens && AccessToken)
		request.authUser = await requestsAuth.tokens.verifyAccessToken(AccessToken).catch((err: any) => {
			if (err instanceof CustomError) request.pendingError = err
			return null
		})
	else if (requestsAuth.apiKey && ApiKey)
		request.authUser = await requestsAuth.apiKey.verifyApiKey?.(ApiKey).catch((err: any) => {
			if (err instanceof CustomError) request.pendingError = err
			return null
		}) ?? null
})
