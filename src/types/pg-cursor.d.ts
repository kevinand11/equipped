declare module 'pg-cursor' {
	export default class Cursor<T extends Record<string, unknown> = Record<string, unknown>> {
		readonly text: string
		readonly values: unknown[] | null

		constructor(text: string, values?: unknown[] | null, config?: Record<string, unknown>)

		read(rowCount: number): Promise<T[]>
		read(rowCount: number, cb: (error: Error | null, rows: T[]) => void): void
		close(): Promise<void>
		close(cb: (error?: Error | null) => void): void
	}
}
