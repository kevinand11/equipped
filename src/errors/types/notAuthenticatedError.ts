import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class NotAuthenticatedError extends CustomError {
	statusCode = StatusCodes.NotAuthenticated

	constructor(message = 'Not authenticated') {
		super(message, [{ message }])
	}
}
