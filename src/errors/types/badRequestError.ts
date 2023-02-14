import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class BadRequestError extends CustomError {
	statusCode = StatusCodes.BadRequest

	constructor (message: string) {
		super(message, [{ message }])
	}
}
