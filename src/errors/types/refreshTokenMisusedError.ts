import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class RefreshTokenMisusedError extends CustomError {
	statusCode = StatusCodes.RefreshTokenMisused

	constructor (message = 'Refresh token misused') {
		super(message, [{ message }])
	}
}
