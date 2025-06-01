import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class RefreshTokenMisusedError extends RequestError {
	statusCode = StatusCodes.NotAuthenticated

	constructor(message = 'Refresh token misused') {
		super(message, [{ message }])
	}
}
