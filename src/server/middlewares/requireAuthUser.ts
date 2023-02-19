import { Request } from '../controllers/request'
import { NotAuthenticatedError } from '../../errors'

export const requireAuthUser = async (request: Request) => {
	if (request.pendingError) throw request.pendingError
	if (!request.authUser) throw new NotAuthenticatedError()
}