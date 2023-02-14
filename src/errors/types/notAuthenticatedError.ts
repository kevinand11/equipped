import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class NotAuthenticatedError extends CustomError {
	statusCode = StatusCodes.NotAuthenticated

	constructor (message = 'Not authenticated') {
		super(message, [{ message }])
	}
}
