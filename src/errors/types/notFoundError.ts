import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class NotFoundError extends CustomError {
	statusCode = StatusCodes.NotFound

	constructor (message = 'Not found') {
		super(message, [{ message }])
	}
}
