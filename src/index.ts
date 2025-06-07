import { EquippedError } from './errors'
import { exit } from './exit'

export * from './db'
export * from './emails'
export * from './errors'
export * from './exit'
export * from './instance'
export * from './listeners'
export * from './requests-auth'
export * from './schemas'
export * from './server'
export * from './types'
export * from './utils/auth'
export * as Hash from './utils/hash'
export * from './utils/retry'
export * from './utils/utils'
export * from './validations'

export const getEnvOrFail = (key: string) => {
	const value = process.env[key]
	if (value) return value
	exit(new EquippedError(`Environment variable not found: ${key}`, {}))
	return ''
}
