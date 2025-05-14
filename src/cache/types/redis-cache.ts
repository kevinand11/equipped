import { Cluster, Redis, RedisOptions } from 'ioredis'

import { exit } from '../../exit'
import { Instance } from '../../instance'
import { Cache } from '../cache'

export class RedisCache extends Cache {
	client: Redis | Cluster

	constructor(extraConfig?: Partial<RedisOptions>) {
		super()
		const settings = Instance.get().settings.redis
		const node = {
			...(settings.host ? { host: settings.host } : {}),
			...(settings.port ? { port: settings.port } : {}),
		}
		const common = {
			...extraConfig,
			...(settings.password ? { password: settings.password } : {}),
			...(settings.username ? { username: settings.username } : {}),
			...(settings.tls ? { tls: {} } : {}),
			lazyConnect: !extraConfig,
		}
		this.client = settings.cluster ? new Cluster([node], {
			...extraConfig,
			redisOptions: common,
			lazyConnect: !extraConfig,
		}) : new Redis({ ...common, ...node })
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
		await this.client.del(Instance.get().getScopedName(key))
	}

	async get(key: string) {
		return await this.client.get(Instance.get().getScopedName(key))
	}

	async set(key: string, data: string, ttlInSecs: number) {
		if (ttlInSecs > 0) await this.client.setex(Instance.get().getScopedName(key), ttlInSecs, data)
		else this.client.set(Instance.get().getScopedName(key), data)
	}

	async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs: number) {
		const cached = await this.get(Instance.get().getScopedName(key))
		if (cached) return JSON.parse(cached)

		const result = await fn()
		await this.set(Instance.get().getScopedName(key), JSON.stringify(result), ttlInSecs)
	}
}
