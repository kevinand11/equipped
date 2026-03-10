import { Cluster, Redis, type ClusterOptions, type RedisOptions } from 'ioredis'
import { v } from 'valleyed'

import { EquippedError } from '../../../errors'
import { Instance } from '../../../instance'
import { configurable } from '../../../utilities'
import { type Cache } from '../base'

export const redisConfigPipe = () =>
	v.meta(
		v.object({
			host: v.string(),
			port: v.optional(v.number()),
			password: v.optional(v.string()),
			username: v.optional(v.string()),
			tls: v.optional(v.boolean()),
			cluster: v.optional(v.boolean()),
		}),
		{ title: 'Redis Config', $refId: 'RedisConfig' },
	)

type RedisCacheOptions = {
	connectionOptions: ClusterOptions | RedisOptions
}

export const RedisCache = configurable(redisConfigPipe, (config, extraConfig?: Partial<RedisOptions>): Cache<RedisCacheOptions> => {
	const node = {
		...(config.host ? { host: config.host } : {}),
		...(config.port ? { port: config.port } : {}),
	}
	const common = {
		...extraConfig,
		...(config.password ? { password: config.password } : {}),
		...(config.username ? { username: config.username } : {}),
		...(config.tls ? { tls: {} } : {}),
		lazyConnect: true,
	}
	const client = config.cluster
		? new Cluster([node], {
				...extraConfig,
				redisOptions: common,
				lazyConnect: true,
			})
		: new Redis({ ...common, ...node })
	client.on('error', async (error) => {
		Instance.crash(new EquippedError(`Redis failed with error`, {}, error))
	})
	if (!extraConfig) Instance.on('start', async () => client.connect(), 1)
	Instance.on('close', async () => client.quit(), 1)

	const getScopedKey = (key: string): string => Instance.get().getScopedName(key, ':')

	const cache: Cache<RedisCacheOptions> = {
		options: { connectionOptions: client.options },
		async delete(key: string) {
			await client.del(getScopedKey(key))
		},
		async get(key: string) {
			return await client.get(getScopedKey(key))
		},
		async set(key: string, data: string, ttlInSecs?: number) {
			if (ttlInSecs) await client.setex(getScopedKey(key), ttlInSecs, data)
			else client.set(getScopedKey(key), data)
		},
		async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs?: number) {
			const cached = await this.get(getScopedKey(key))
			if (cached) return JSON.parse(cached)

			const result = await fn()
			await this.set(getScopedKey(key), JSON.stringify(result), ttlInSecs)
		},
	}

	return cache
})
