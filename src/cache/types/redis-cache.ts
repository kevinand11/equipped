import { createClient } from 'redis'
import { Instance } from '../../instance'
import { exit } from '../../exit'
import { Cache } from '../cache'

export class RedisCache extends Cache {
	client: ReturnType<typeof createClient>

	constructor () {
		super()
		this.client = createClient({ url: Instance.get().settings.redisURI })
		this.client.on('error', async (error) => {
			exit(`Redis failed with error: ${error}`)
		})
	}

	async start () {
		await this.client.connect()
	}

	async close () {
		this.client.quit()
	}

	async delete (key: string) {
		await this.client.del(key)
	}

	async get (key: string) {
		return await this.client.get(key)
	}

	async set (key: string, data: string, ttlInSecs: number) {
		if (ttlInSecs > 0) await this.client.setEx(key, ttlInSecs, data)
		else this.client.set(key, data)
	}

	async setInTransaction (key: string, data: string, ttlInSecs: number) {
		return await this.client.multi()
			.get(key)
			.setEx(key, ttlInSecs, data)
			.exec() as [string, string]
	}
}