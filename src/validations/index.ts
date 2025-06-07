import * as bcrypt from 'bcryptjs'
export * from 'valleyed'
export * as v from './valleyed'
import { Pipe, PipeOutput } from 'valleyed'

import { ValidationError } from '../errors'
import { Instance } from '../instance'

export function validate<T extends Pipe<unknown, unknown>>(pipe: T, value: unknown): PipeOutput<T> {
	const validity = pipe.safeParse(value)
	if (validity.valid) return validity.value as PipeOutput<T>
	const errorsObject = validity.error.messages
		.map((error) => {
			const splitKey = ': '
			const [field, ...rest] = error.split(splitKey)
			return { field, message: rest.join(splitKey) }
		})
		.reduce(
			(acc, cur) => {
				if (acc[cur.field]) acc[cur.field].push(cur.message)
				else acc[cur.field] = [cur.message]
				return acc
			},
			{} as Record<string, string[]>,
		)

	throw new ValidationError(Object.entries(errorsObject).map(([key, value]) => ({ field: key, messages: value })))
}

const hash = async (password: string) => {
	password = password.trim()
	if (!password) return ''
	return await bcrypt.hash(password, Instance.get().settings.hashSaltRounds)
}

const compare = async (plainPassword: string, hashed: string) => {
	plainPassword = plainPassword.trim()
	if (!plainPassword && plainPassword === hashed) return true
	return await bcrypt.compare(plainPassword, hashed)
}

export const Hash = { hash, compare }
