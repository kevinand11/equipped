import { v } from 'valleyed'

import { Instance } from '../../../instance'
import { configurable } from '../../../utilities'
import { Cache } from '../base'

type CacheEntry = {
	data: string
	expiredAt?: number
}

export const inMemoryCacheConfigPipe = () => v.object({})
export class InMemoryCache extends configurable(
	inMemoryCacheConfigPipe,
	class extends Cache {
		#caches = new Map<string, CacheEntry>()
		#interval?: ReturnType<typeof setInterval>

		constructor() {
			super()
			Instance.on(
				'start',
				async () => {
					this.#interval = setInterval(() => {
						const now = Date.now()
						for (const [key, record] of this.#caches.entries()) {
							if (record.expiredAt && record.expiredAt <= now) this.#caches.delete(key)
						}
					}, 5000)
				},
				1,
			)
			Instance.on('close', async () => clearInterval(this.#interval), 1)
		}

		async delete(key: string) {
			this.#caches.delete(this.getScopedKey(key))
		}
		async get(key: string) {
			const record = this.#caches.get(this.getScopedKey(key))
			if (record && (record.expiredAt === undefined || record.expiredAt > Date.now())) return record.data
			return null
		}
		async set(key: string, data: string, ttlInSecs?: number) {
			this.#caches.set(this.getScopedKey(key), { data, expiredAt: ttlInSecs ? Date.now() + ttlInSecs * 1000 : undefined })
		}
	},
) {}
