import { createClient } from 'redis'

import { exit } from '../../exit'
import { Instance } from '../../instance'
import { Cache } from '../cache'

export class RedisCache extends Cache {
	client: ReturnType<typeof createClient>

	constructor() {
		super()
		this.client = createClient({ url: Instance.get().settings.redisURI })
		this.client.on('error', async (error) => {
			exit(`Redis failed with error: ${error}`)
		})
	}

	async start() {
		await this.client.connect()
	}

	async close() {
		this.client.quit()
	}

	async delete(key: string) {
		await this.client.del(key)
	}

	async get(key: string) {
		return await this.client.get(key)
	}

	async set(key: string, data: string, ttlInSecs: number) {
		if (ttlInSecs > 0) await this.client.setEx(key, ttlInSecs, data)
		else this.client.set(key, data)
	}

	async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs: number) {
		const cached = await this.get(key)
		if (cached) return JSON.parse(cached)

		const result = await fn()
		await this.set(key, JSON.stringify(result), ttlInSecs)
	}
}
