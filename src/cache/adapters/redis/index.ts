import { Cluster, Redis, type RedisOptions } from 'ioredis'
import { v, type PipeOutput } from 'valleyed'

import { EquippedError } from '../../../errors'
import { Instance } from '../../../instance'
import { configurable } from '../../../utilities'
import { Cache } from '../base'

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

export class RedisCache extends configurable(
	redisConfigPipe,
	class extends Cache {
		#client: Cluster | Redis

		constructor(config: PipeOutput<ReturnType<typeof redisConfigPipe>>, extraConfig?: Partial<RedisOptions>) {
			super()
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
			this.#client = config.cluster
				? new Cluster([node], {
						...extraConfig,
						redisOptions: common,
						lazyConnect: true,
					})
				: new Redis({ ...common, ...node })
			this.#client.on('error', async (error) => {
				Instance.crash(new EquippedError(`Redis failed with error`, {}, error))
			})
			if (!extraConfig) Instance.on('start', async () => this.#client.connect(), 1)
			Instance.on('close', async () => this.#client.quit(), 1)
		}

		get connectionOptions () {
			return this.#client.options
		}

		async delete(key: string) {
			await this.#client.del(this.getScopedKey(key))
		}
		async get(key: string) {
			return await this.#client.get(this.getScopedKey(key))
		}
		async set(key: string, data: string, ttlInSecs?: number) {
			if (ttlInSecs) await this.#client.setex(this.getScopedKey(key), ttlInSecs, data)
			else this.#client.set(this.getScopedKey(key), data)
		}
	},
) {}
