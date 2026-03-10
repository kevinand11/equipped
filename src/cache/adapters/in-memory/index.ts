import { v } from 'valleyed'

import { Instance } from '../../../instance'
import { configurable } from '../../../utilities'
import { type Cache } from '../base'

type CacheEntry = {
	data: string
	expiredAt?: number
}

export const inMemoryCacheConfigPipe = () => v.object({})

export const InMemoryCache = configurable(inMemoryCacheConfigPipe, (): Cache<{}> => {
	const caches = new Map<string, CacheEntry>()
	let interval: ReturnType<typeof setInterval> | undefined
	Instance.on(
		'start',
		async () => {
			interval = setInterval(() => {
				const now = Date.now()
				for (const [key, record] of caches.entries()) {
					if (record.expiredAt && record.expiredAt <= now) caches.delete(key)
				}
			}, 5000)
		},
		1,
	)
	Instance.on('close', async () => clearInterval(interval), 1)

	const getScopedKey = (key: string) => Instance.get().getScopedName(key, ':')

	const cache: Cache<{}> = {
		options: {},
		async delete(key: string) {
			caches.delete(getScopedKey(key))
		},
		async get(key: string) {
			const record = caches.get(getScopedKey(key))
			if (record && (record.expiredAt === undefined || record.expiredAt > Date.now())) return record.data
			return null
		},
		async set(key: string, data: string, ttlInSecs?: number) {
			caches.set(getScopedKey(key), { data, expiredAt: ttlInSecs ? Date.now() + ttlInSecs * 1000 : undefined })
		},
		async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs?: number): Promise<T> {
			const cached = await this.get(key)
			if (cached) return JSON.parse(cached) as T

			const result = await fn()
			await this.set(key, JSON.stringify(result), ttlInSecs)
			return result
		},
	}

	return cache
})
