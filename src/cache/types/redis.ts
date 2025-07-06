import { Cluster, Redis, RedisOptions } from 'ioredis'

import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import { Cache } from '../base'
import { RedisConfig } from '../pipes'

export class RedisCache extends Cache {
	client: Redis | Cluster

	constructor(settings: RedisConfig, extraConfig?: Partial<RedisOptions>) {
		super()
		const node = {
			...(settings.host ? { host: settings.host } : {}),
			...(settings.port ? { port: settings.port } : {}),
		}
		const common = {
			...extraConfig,
			...(settings.password ? { password: settings.password } : {}),
			...(settings.username ? { username: settings.username } : {}),
			...(settings.tls ? { tls: {} } : {}),
			lazyConnect: true,
		}
		this.client = settings.cluster
			? new Cluster([node], {
					...extraConfig,
					redisOptions: common,
					lazyConnect: true,
				})
			: new Redis({ ...common, ...node })
		this.client.on('error', async (error) => {
			Instance.crash(new EquippedError(`Redis failed with error`, {}, error))
		})
		if (!extraConfig) Instance.on('start', async () => this.client.connect(), 1)
		Instance.on('close', async () => this.client.quit(), 1)
	}

	private getScopedKey(key: string): string {
		return Instance.get().getScopedName(key, ':')
	}

	async delete(key: string) {
		await this.client.del(this.getScopedKey(key))
	}

	async get(key: string) {
		return await this.client.get(this.getScopedKey(key))
	}

	async set(key: string, data: string, ttlInSecs?: number) {
		if (ttlInSecs) await this.client.setex(this.getScopedKey(key), ttlInSecs, data)
		else this.client.set(this.getScopedKey(key), data)
	}

	async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs?: number) {
		const cached = await this.get(this.getScopedKey(key))
		if (cached) return JSON.parse(cached)

		const result = await fn()
		await this.set(this.getScopedKey(key), JSON.stringify(result), ttlInSecs)
	}
}
