import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

type ValidError = {
	messages: string[]
	field: string
}

export class ValidationError extends RequestError {
	statusCode = StatusCodes.ValidationError

	constructor(errors: ValidError[], cause?: unknown) {
		super(
			'Unprocessable Entity',
			errors.flatMap(({ field, messages }) => messages.map((message) => ({ message, field }))),
			cause,
		)
	}
}
