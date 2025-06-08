import type { StatusCodesEnum } from '../server'
import { EquippedError } from './equippedError'

export abstract class RequestError extends EquippedError {
	abstract readonly statusCode: StatusCodesEnum

	protected constructor(
		public readonly message: string,
		public readonly serializedErrors: { message: string; field?: string }[],
		cause?: unknown,
	) {
		super(message, { serializedErrors }, cause)
	}
}
