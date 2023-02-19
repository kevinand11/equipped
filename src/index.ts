import dotenv from 'dotenv'
import { exit } from './exit'

dotenv.config()

export * from './db'
export * from './emails'
export * from './enums'
export { Enum } from './enums/types'
export * from './errors'
export { Events } from './events/events'
export * from './exit'
export * from './instance'
export * from './listeners'
export * from './server'
export * from './storage'
export * from './structure'
export * from './utils/auth'
export * from './utils/authUser'
export * from './utils/tokens'
export * from './utils/utils'
export * from './validations'

export const getEnvOrFail = (key: string) => {
	const value = process.env[key]
	if (value) return value
	exit(`Environment variable not found: ${key}`)
	return ''
}