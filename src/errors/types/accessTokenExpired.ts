import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class AccessTokenExpired extends CustomError {
	statusCode = StatusCodes.AccessTokenExpired

	constructor(message = 'Access token expired') {
		super(message, [{ message }])
	}
}
