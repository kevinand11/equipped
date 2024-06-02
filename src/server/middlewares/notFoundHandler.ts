import { NotFoundError } from '../../errors'
import { makeMiddleware } from '../types'

export const notFoundHandler = makeMiddleware(
	async (req) => {
		throw new NotFoundError(`Route ${req.path} not found`)
	}
)