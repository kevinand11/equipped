import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class RefreshTokenMisusedError extends CustomError {
	statusCode = StatusCodes.RefreshTokenMisused

	constructor (message = 'Refresh token misused') {
		super(message, [{ message }])
	}
}
