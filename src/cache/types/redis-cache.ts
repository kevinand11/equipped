import { Cluster, Redis, RedisOptions } from 'ioredis'

import { Cache } from '../'
import { EquippedError } from '../../errors'
import { Instance } from '../../instance'
import { RedisConfig } from '../../schemas'

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
			lazyConnect: !extraConfig,
		}
		this.client = settings.cluster
			? new Cluster([node], {
					...extraConfig,
					redisOptions: common,
					lazyConnect: !extraConfig,
				})
			: new Redis({ ...common, ...node })
		this.client.on('error', async (error) => {
			Instance.crash(new EquippedError(`Redis failed with error`, {}, error))
		})
		Instance.addHook('pre:start', async () => this.client.connect(), 1)
		Instance.addHook('pre:close', async () => this.client.quit(), 1)
	}

	async delete(key: string) {
		await this.client.del(Instance.get().getScopedName(key, ':'))
	}

	async get(key: string) {
		return await this.client.get(Instance.get().getScopedName(key, ':'))
	}

	async set(key: string, data: string, ttlInSecs: number) {
		if (ttlInSecs > 0) await this.client.setex(Instance.get().getScopedName(key, ':'), ttlInSecs, data)
		else this.client.set(Instance.get().getScopedName(key), data)
	}

	async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs: number) {
		const cached = await this.get(Instance.get().getScopedName(key, ':'))
		if (cached) return JSON.parse(cached)

		const result = await fn()
		await this.set(Instance.get().getScopedName(key, ':'), JSON.stringify(result), ttlInSecs)
	}
}
