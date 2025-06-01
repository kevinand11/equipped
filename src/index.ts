import { EquippedError } from './errors'
import { exit } from './exit'

export * from './db'
export * from './emails'
export * from './errors'
export * from './exit'
export * from './instance'
export * from './listeners'
export * from './requests-auth'
export * from './scripts'
export * from './server'
export * from './storage'
export * from './types'
export * from './types/overrides'
export * from './utils/auth'
export * from './utils/retry'
export * from './utils/utils'
export * from './validations'

export const getEnvOrFail = (key: string) => {
	const value = process.env[key]
	if (value) return value
	exit(new EquippedError(`Environment variable not found: ${key}`, {}))
	return ''
}
