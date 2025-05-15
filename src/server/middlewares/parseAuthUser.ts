import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { verifyAccessToken } from '../../utils/tokens'
import { makeMiddleware } from '../types'

export const parseAuthUser = makeMiddleware(async (request) => {
	const { requestsAuth } = Instance.get().settings
	const { AccessToken, ApiKey } = request.headers
	if (requestsAuth.accessToken && AccessToken)
		request.authUser = await verifyAccessToken(AccessToken).catch((err: any) => {
			if (err instanceof CustomError) request.pendingError = err
			return null
		})
	else if (requestsAuth.apiKey && ApiKey)
		request.authUser = await requestsAuth.apiKey.verify?.(ApiKey).catch((err: any) => {
			if (err instanceof CustomError) request.pendingError = err
			return null
		}) ?? null
})
