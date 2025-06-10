import crypto from 'crypto'

export class Random {
	static string(length = 20) {
		return crypto.randomBytes(length).toString('hex').slice(0, length)
	}

	static number(min = 0, max = 2 ** 48 - 1) {
		return crypto.randomInt(min, max)
	}
}
