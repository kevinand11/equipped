import { NotAuthorizedError } from '../../errors'
import { verifyRefreshToken } from '../../utils/tokens'
import { Request } from '../controllers/request'

export const requireRefreshUser = async (request: Request) => {
	const refreshToken = request.headers.RefreshToken
	if (!refreshToken) throw new NotAuthorizedError()
	request.refreshUser = await verifyRefreshToken(refreshToken)
	if (!request.refreshUser) throw new NotAuthorizedError()
}