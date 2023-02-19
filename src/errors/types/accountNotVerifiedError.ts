import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

export class AccountNotVerifiedError extends CustomError {
	statusCode = StatusCodes.AccountNotVerified

	constructor (message = 'Account not verified') {
		super(message, [{ message }])
	}
}
