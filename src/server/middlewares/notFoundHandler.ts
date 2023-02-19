import { makeMiddleware } from '../controllers'
import { NotFoundError } from '../../errors'

export const notFoundHandler = makeMiddleware(
	async (_) => {
		throw new NotFoundError('Route not found')
	}
)
