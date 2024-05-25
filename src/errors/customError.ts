import { SupportedStatusCodes } from '../server'

export abstract class CustomError extends Error {
	abstract readonly statusCode: SupportedStatusCodes
	readonly message: string
	readonly serializedErrors: { message: string; field?: string }[]

	protected constructor (message: string, serializedErrors: { message: string; field?: string }[]) {
		super(message)
		this.message = message
		this.serializedErrors = serializedErrors
	}
}
