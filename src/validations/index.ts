import * as bcrypt from 'bcryptjs'
import * as Validate from 'valleyed'
import type { ExtractO } from 'valleyed/lib/api/base'
import type { VCore } from 'valleyed/lib/api/core'
import type { VObject } from 'valleyed/lib/api/objects'

import { ValidationError } from '../errors'
import { Instance } from '../instance'
import type { StorageFile } from '../storage'

const isNotTruncated = (error?: string) =>
	Validate.makeRule<StorageFile>((file) => {
		const val = file as StorageFile
		error = error ?? `is larger than allowed limit of ${Instance.get().settings.requests.maxFileUploadSizeInMb}mb`
		const valid = val ? !val.isTruncated : true
		return valid ? Validate.isValid(val) : Validate.isInvalid([error], val)
	})

type Phone = { code: string; number: string }
const isValidPhone = (error?: string) =>
	Validate.makeRule<Phone>((value) =>
		Validate.v
			.object({
				code: Validate.v
					.string()
					.custom(
						(val) => val.startsWith('+') && Validate.v.force.number(val.slice(1)).parse(val).valid,
						error ?? 'invalid phone code',
					),
				number: Validate.v.force.number(error ?? 'invalid phone number').transform((val) => val.toString()),
			})
			.parse(value),
	)

const file = Validate.v.file
Validate.v.file = (...args: Parameters<typeof file>) => file(...args).addRule(isNotTruncated())
export const Schema = Validate.v
export const Validation = { ...Validate, isNotTruncated, isValidPhone }

export function validate<T extends Record<string, VCore<any>>>(schema: T, value: unknown): ExtractO<VObject<T>>
// eslint-disable-next-line no-redeclare
export function validate<T extends VCore<any>>(schema: T, value: unknown): ExtractO<T>
// eslint-disable-next-line no-redeclare
export function validate(schema, value) {
	const validator = schema instanceof Validate.VCore ? schema : Validate.v.object(schema)
	const validity = validator.parse(value)
	if (validity.valid) return validity.value
	const errorsObject = validity.errors
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

declare module 'valleyed/lib/types' {
	interface File extends StorageFile {}
}
