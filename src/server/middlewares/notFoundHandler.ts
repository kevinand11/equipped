import { NotFoundError } from '../../errors'
import { makeMiddleware } from '../routes'

export const notFoundHandler = makeMiddleware(
	async (_) => {
		throw new NotFoundError('Route not found')
	}
)