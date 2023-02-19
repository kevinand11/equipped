import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class InvalidToken extends CustomError {
	statusCode = StatusCodes.AccessTokenExpired

	constructor (message = 'Token is either expired or invalid') {
		super(message, [{ message }])
	}
}
