import * as bcrypt from 'bcryptjs'
import * as Validate from 'valleyed'
import { VCore } from 'valleyed/lib/api/core'
import { ValidationError } from '../errors'
import { Instance } from '../instance'
import { StorageFile } from '../storage'

const isNotTruncated = (error?: string) => Validate.makeRule<StorageFile>((file) => {
	const val = file as StorageFile
	error = error ?? `is larger than allowed limit of ${Instance.get().settings.maxFileUploadSizeInMb}mb`
	const valid = val ? !val.isTruncated : true
	return valid ? Validate.isValid(val) : Validate.isInvalid([error], val)
})


type Phone = { code: string, number: string }
const isValidPhone = (error?: string) => Validate.makeRule<Phone>((value) => {
	const phone = value as Phone
	const { code = '', number = '' } = phone ?? {}
	const isValidCode = Validate.isString()(code).valid &&
		code.startsWith('+') &&
		Validate.isNumber()(parseInt(code.slice(1))).valid
	const isValidNumber = Validate.isNumber()(parseInt(number)).valid
	if (!isValidCode) return Validate.isInvalid([error ?? 'invalid phone code'], phone)
	if (!isValidNumber) return Validate.isInvalid([error ?? 'invalid phone number'], phone)
	return Validate.isValid(phone)
})

const file = Validate.v.file
Validate.v.file = (...args: Parameters<typeof file>) => file(...args).addRule(isNotTruncated())
export const Schema = Validate.v
export const Validation = { ...Validate, isNotTruncated, isValidPhone }

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

declare module 'valleyed/lib/rules/files' {
    interface File extends StorageFile {}
}