import * as bcrypt from 'bcryptjs'
import * as Validate from 'valleyed'
import { VCore } from 'valleyed/lib/api/core'
import { ValidationError } from '../errors'
import { Instance } from '../instance'
import { StorageFile } from '../storage'

const isNotTruncated = (error?: string) => Validate.makeRule((file: StorageFile) => {
	error = error ?? `is larger than allowed limit of ${Instance.get().settings.maxFileUploadSizeInMb}mb`
	const valid = file ? !file.isTruncated : true
	return valid ? Validate.isValid(file) : Validate.isInvalid([error], file)
})

export const Validation = { ...Validate, isNotTruncated }

type Rules<T> = {
	required?: boolean | (() => boolean)
	nullable?: boolean
	rules: Validate.Rule<T>[]
}

export const validate = <Keys extends Record<string, any>> (data: Keys, rules: Record<keyof Keys, Rules<any>>) => {
	const errors = Object.entries(data)
		.map(([key, value]) => ({
			key,
			validity: Validation.Validator.and(value, [rules[key].rules], {
				required: rules[key].required,
				nullable: rules[key].nullable
			})
		}))

	const failed = errors.some(({ validity }) => !validity.valid)

	if (failed) throw new ValidationError(
		errors
			.filter(({ validity }) => !validity.valid)
			.map(({ key, validity }) => ({ field: key, messages: validity.errors }))
	)

	return data
}

export const validateReq = <T extends Record<string, VCore<any, any>>>(schema: T, value: Record<string, any>) => {
	const validity = Validation.v.object(schema).parse(value)
	if (validity.valid) return validity.value
	const errorsObject = validity.errors
		.map((error) => {
			const splitKey = ': '
			const [field, ...rest] = error.split(splitKey)
			return { field, message: rest.join(splitKey) }
		}).reduce(((acc, cur) => {
			if (acc[cur.field]) acc[cur.field].push(cur.message)
			else acc[cur.field] = [cur.message]
			return acc
		}), {} as Record<string, string[]>)

	throw new ValidationError(
		Object.entries(errorsObject)
			.map(([key, value]) => ({ field: key, messages: value }))
	)
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