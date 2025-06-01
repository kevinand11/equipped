import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class NotAuthenticatedError extends RequestError {
	statusCode = StatusCodes.NotAuthenticated

	constructor(message = 'Not authenticated') {
		super(message, [{ message }])
	}
}
