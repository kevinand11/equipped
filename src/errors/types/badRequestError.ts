import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class BadRequestError extends RequestError {
	statusCode = StatusCodes.BadRequest

	constructor(message: string, error?: Error) {
		super(message, [{ message }], error)
	}
}
