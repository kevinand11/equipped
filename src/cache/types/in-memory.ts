import { Instance } from '../../instance'
import { Cache } from '../base'

type CacheEntry = {
	data: string
	expiredAt?: number
}

export class InMemoryCache extends Cache {
	private readonly cache = new Map<string, CacheEntry>()

	constructor() {
		super()
		let interval: ReturnType<typeof setInterval> | undefined
		Instance.on(
			'start',
			async () => {
				interval = setInterval(() => {
					const now = Date.now()
					for (const [key, record] of this.cache.entries()) {
						if (record.expiredAt && record.expiredAt <= now) this.cache.delete(key)
					}
				}, 5000)
			},
			1,
		)
		Instance.on('close', async () => clearInterval(interval), 1)
	}

	private getScopedKey(key: string): string {
		return Instance.get().getScopedName(key, ':')
	}

	async delete(key: string) {
		this.cache.delete(this.getScopedKey(key))
	}

	async get(key: string) {
		const record = this.cache.get(this.getScopedKey(key))
		if (record && (record.expiredAt === undefined || record.expiredAt > Date.now())) return record.data
		return null
	}

	async set(key: string, data: string, ttlInSecs?: number) {
		this.cache.set(this.getScopedKey(key), { data, expiredAt: ttlInSecs ? Date.now() + ttlInSecs * 1000 : undefined })
	}

	async getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs?: number): Promise<T> {
		const cached = await this.get(key)
		if (cached) return JSON.parse(cached) as T

		const result = await fn()
		await this.set(key, JSON.stringify(result), ttlInSecs)
		return result
	}
}
