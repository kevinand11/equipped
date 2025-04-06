import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class NotAuthorizedError extends CustomError {
	statusCode = StatusCodes.NotAuthorized

	constructor(message = 'Not authorized') {
		super(message, [{ message }])
	}
}
