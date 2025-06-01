import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class NotAuthorizedError extends RequestError {
	statusCode = StatusCodes.NotAuthorized

	constructor(message = 'Not authorized', error?: Error) {
		super(message, [{ message }], error)
	}
}
