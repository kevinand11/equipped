import dotenv from 'dotenv'

dotenv.config()

export { generateMongoDbChange }  from './db'
export * from './db/mongoose'
export * from './emails'
export * from './enums'
export { Enum } from './enums/types'
export * from './errors'
export { Events } from './events/events'
export * from './exit'
export * from './express'
export * from './instance'
export * from './listeners'
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
	// eslint-disable-next-line no-console
	console.error(`Environment variable not found: ${key}`)
	process.exit(1)
}