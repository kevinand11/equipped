import { CustomError } from '../customError'
import { StatusCodes } from '../../express'

export class AccountNotVerifiedError extends CustomError {
	statusCode = StatusCodes.AccountNotVerified

	constructor (message = 'Account not verified') {
		super(message, [{ message }])
	}
}
