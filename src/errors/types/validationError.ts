import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

type Error = {
	messages: string[]
	field: string
}

export class ValidationError extends RequestError {
	statusCode = StatusCodes.ValidationError

	constructor(errors: Error[]) {
		super(
			'Invalid request parameters',
			errors.map((e) => ({ field: e.field, message: e.messages.join('\n') })),
		)
	}
}
