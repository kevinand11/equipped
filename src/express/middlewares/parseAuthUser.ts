import { makeMiddleware } from '../controllers'
import { verifyAccessToken } from '../../utils/tokens'
import { CustomError } from '../../errors'

export const parseAuthUser = makeMiddleware(
	async (request) => {
		const accessToken = request.headers.AccessToken
		if (accessToken) request.authUser = await verifyAccessToken(accessToken).catch((err: any) => {
			if (err instanceof CustomError) request.pendingError = err
			return null
		})
	}
)
