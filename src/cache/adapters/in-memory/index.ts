import { v } from 'valleyed'

import { Instance } from '../../../instance'
import { configurable } from '../../../utilities'
import { Cache } from '../base'

type CacheEntry = {
	data: string
	expiredAt?: number
}

export const inMemoryCacheConfigPipe = () => v.object({})

export class InMemoryCache extends configurable(inMemoryCacheConfigPipe, Cache) {
	#caches = new Map<string, CacheEntry>()
	#interval?: ReturnType<typeof setInterval>

	protected constructor(config: typeof InMemoryCache.Config) {
		super(config)
		Instance.on('start', async () => {
			this.#interval = setInterval(() => {
				const now = Date.now()
				for (const [key, record] of this.#caches.entries()) {
					if (record.expiredAt && record.expiredAt <= now) this.#caches.delete(key)
				}
			}, 5000)
		}, { class: InMemoryCache })
		Instance.on('close', async () => clearInterval(this.#interval), { class: InMemoryCache })
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
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf, vi, beforeEach, afterEach } = import.meta.vitest

	let hookCalls: Array<{ event: string; options?: any }>

	beforeEach(() => {
		hookCalls = []
		vi.spyOn(Instance, 'on').mockImplementation((event, _cb, options) => {
			hookCalls.push({ event, options })
		})
		vi.spyOn(Instance, 'get').mockReturnValue({ getScopedName: (_name: string, _sep: string) => `test:${_name}` } as any)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('InMemoryCache', () => {
		test('create() produces a working instance', () => {
			const cache = InMemoryCache.create({})
			expect(cache).toBeInstanceOf(InMemoryCache)
		})

		test('new InMemoryCache() is a compile error', () => {
			// @ts-expect-error — external `new` on a class with protected constructor is a compile error
			void (() => new InMemoryCache({}))
		})

		test('Instance.on calls use { class: InMemoryCache }', () => {
			InMemoryCache.create({})
			const startHook = hookCalls.find((h) => h.event === 'start')
			const closeHook = hookCalls.find((h) => h.event === 'close')
			expect(startHook?.options).toEqual({ class: InMemoryCache })
			expect(closeHook?.options).toEqual({ class: InMemoryCache })
		})

		test('set/get/delete work correctly', async () => {
			const cache = InMemoryCache.create({})
			await cache.set('key1', 'value1')
			expect(await cache.get('key1')).toBe('value1')
			await cache.delete('key1')
			expect(await cache.get('key1')).toBeNull()
		})

		test('get returns null after ttl expires', async () => {
			const now = Date.now()
			vi.spyOn(Date, 'now').mockReturnValue(now)
			const cache = InMemoryCache.create({})
			await cache.set('key1', 'value1', 1)
			vi.spyOn(Date, 'now').mockReturnValue(now + 1001)
			expect(await cache.get('key1')).toBeNull()
		})

		test('Config type is accessible', () => {
			type PipeOutput<T> = import('valleyed').PipeOutput<T>
			type Expected = PipeOutput<ReturnType<typeof inMemoryCacheConfigPipe>>
			expectTypeOf<typeof InMemoryCache.Config>().toEqualTypeOf<Expected>()
		})
	})
}
