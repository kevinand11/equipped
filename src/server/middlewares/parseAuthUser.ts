import { CustomError } from '../../errors'
import { verifyAccessToken } from '../../utils/tokens'
import { makeMiddleware } from '../controllers'

export const parseAuthUser = makeMiddleware(
	async (request) => {
		const accessToken = request.headers.AccessToken
		if (accessToken) request.authUser = await verifyAccessToken(accessToken).catch((err: any) => {
			if (err instanceof CustomError) request.pendingError = err
			return null
		})
	}
)