import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class AuthorizationExpired extends RequestError {
	statusCode = StatusCodes.AuthorizationExpired

	constructor(message = 'Access token expired') {
		super(message, [{ message }])
	}
}
