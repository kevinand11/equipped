import { NotFoundError } from '../../errors'
import { makeMiddleware } from '../controllers'

export const notFoundHandler = makeMiddleware(
	async (_) => {
		throw new NotFoundError('Route not found')
	}
)