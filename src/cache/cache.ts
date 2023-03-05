export abstract class Cache {
	abstract start (): Promise<void>
	abstract close (): Promise<void>

	abstract set (key: string, data: string, ttlInSecs: number): Promise<void>

	abstract get (key: string): Promise<string | null>

	abstract delete (key: string): Promise<void>
}