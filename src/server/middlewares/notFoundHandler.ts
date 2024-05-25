import { NotFoundError } from '../../errors'
import { makeMiddleware } from '../routes'

export const notFoundHandler = makeMiddleware(
	async (req) => {
		throw new NotFoundError(`Route ${req.path} not found`)
	}
)