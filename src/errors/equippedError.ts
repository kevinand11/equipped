export class EquippedError extends Error {
	constructor(
		public readonly message: string,
		public readonly context: Record<string, unknown>,
		public readonly error?: Error,
	) {
		super(message, { cause: error })
	}
}
