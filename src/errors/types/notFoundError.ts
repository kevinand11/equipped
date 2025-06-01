import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class NotFoundError extends RequestError {
	statusCode = StatusCodes.NotFound

	constructor(message = 'Not found') {
		super(message, [{ message }])
	}
}
