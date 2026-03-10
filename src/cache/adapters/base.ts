export type Cache<Options> = {
	options: Options
	set: (key: string, data: string, ttlInSecs?: number) => Promise<void>
	get: (key: string) => Promise<string | null>
	delete: (key: string) => Promise<void>
	getOrSet: <T>(key: string, fn: () => Promise<T>, ttlInSecs?: number) => Promise<T>
}
