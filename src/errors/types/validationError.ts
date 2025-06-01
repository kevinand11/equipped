import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

type ValidError = {
	messages: string[]
	field: string
}

export class ValidationError extends RequestError {
	statusCode = StatusCodes.ValidationError

	constructor(errors: ValidError[], error?: Error) {
		super(
			'Invalid request parameters',
			errors.map((e) => ({ field: e.field, message: e.messages.join('\n') })),
			error,
		)
	}
}
