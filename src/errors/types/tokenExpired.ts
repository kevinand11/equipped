import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class TokenExpired extends RequestError {
	statusCode = StatusCodes.TokenExpired

	constructor(message = 'Token expired', cause?: unknown) {
		super(message, [{ message }], cause)
	}
}
