import { NotAuthenticatedError } from '../../errors'
import { Request } from '../controllers/request'

export const requireAuthUser = async (request: Request) => {
	if (request.pendingError) throw request.pendingError
	if (!request.authUser) throw new NotAuthenticatedError()
}