import { StatusCodes } from '../../server'
import { CustomError } from '../customError'

type Error = {
	messages: string[]
	field: string
}

export class ValidationError extends CustomError {
	statusCode = StatusCodes.ValidationError

	constructor(errors: Error[]) {
		super(
			'Invalid request parameters',
			errors.map((e) => ({ field: e.field, message: e.messages.join('\n') })),
		)
	}
}
