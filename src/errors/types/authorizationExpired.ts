import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class AuthorizationExpired extends CustomError {
	statusCode = StatusCodes.AuthorizationExpired

	constructor(message = 'Access token expired') {
		super(message, [{ message }])
	}
}
