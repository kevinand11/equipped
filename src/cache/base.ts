export abstract class Cache {
	abstract set(key: string, data: string, ttlInSecs?: number): Promise<void>

	abstract get(key: string): Promise<string | null>

	abstract delete(key: string): Promise<void>

	abstract getOrSet<T>(key: string, fn: () => Promise<T>, ttlInSecs?: number): Promise<T>
}
