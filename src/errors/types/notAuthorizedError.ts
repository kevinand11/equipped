import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class NotAuthorizedError extends CustomError {
	statusCode = StatusCodes.NotAuthorized

	constructor (message = 'Not authorized') {
		super(message, [{ message }])
	}
}
