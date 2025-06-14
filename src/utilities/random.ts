import crypto from 'crypto'

export function string(length = 20) {
	return crypto.randomBytes(length).toString('hex').slice(0, length)
}

export function number(min = 0, max = 2 ** 48 - 1) {
	return crypto.randomInt(min, max)
}
