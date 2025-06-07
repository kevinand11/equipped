export * from 'valleyed'
export * as v from './valleyed'
import { Pipe, PipeOutput } from 'valleyed'

import { ValidationError } from '../errors'

export function validate<T extends Pipe<unknown, unknown>>(pipe: T, value: unknown): PipeOutput<T> {
	const validity = pipe.safeParse(value)
	if (validity.valid) return validity.value as PipeOutput<T>
	const errorsObject = validity.error.messages.reduce<Record<string, { field: string; messages: string[] }>>(
		(acc, { path = '', message }) => {
			if (acc[path]) acc[path].messages.push(message)
			else acc[path] = { field: path, messages: [message] }
			return acc
		},
		{},
	)

	throw new ValidationError(Object.values(errorsObject))
}
