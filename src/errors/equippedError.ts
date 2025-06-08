export class EquippedError extends Error {
	constructor(
		public readonly message: string,
		public readonly context: Record<string, unknown>,
		public readonly cause?: unknown,
	) {
		super(message, { cause })
	}
}
