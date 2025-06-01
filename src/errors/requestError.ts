import type { StatusCodes } from '../server'
import { EquippedError } from './equippedError'

export abstract class RequestError extends EquippedError {
	abstract readonly statusCode: StatusCodes

	protected constructor(
		public readonly message: string,
		public readonly serializedErrors: { message: string; field?: string }[],
	) {
		super(message, { serializedErrors })
	}
}
