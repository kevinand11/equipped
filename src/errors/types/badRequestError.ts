import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class BadRequestError extends CustomError {
	statusCode = StatusCodes.BadRequest

	constructor(message: string) {
		super(message, [{ message }])
	}
}
