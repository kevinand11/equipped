import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class NotFoundError extends CustomError {
	statusCode = StatusCodes.NotFound

	constructor (message = 'Not found') {
		super(message, [{ message }])
	}
}
