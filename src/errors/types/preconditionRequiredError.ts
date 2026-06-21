import { StatusCodes } from '../../server'
import { RequestError } from '../requestError'

export class PreconditionRequiredError extends RequestError {
	statusCode = StatusCodes.PreconditionRequired

	constructor(message = 'Precondition required', cause?: unknown) {
		super(message, [{ message }], cause)
	}
}
