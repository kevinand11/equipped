import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class AccessTokenExpired extends CustomError {
	statusCode = StatusCodes.AccessTokenExpired

	constructor (message = 'Access token expired') {
		super(message, [{ message }])
	}
}
