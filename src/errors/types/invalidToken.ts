import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class InvalidToken extends CustomError {
	statusCode = StatusCodes.AccessTokenExpired

	constructor (message = 'Token is either expired or invalid') {
		super(message, [{ message }])
	}
}
