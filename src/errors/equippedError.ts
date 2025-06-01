export abstract class EquippedError extends Error {
	protected constructor(
		public readonly message: string,
		public readonly context: Record<string, unknown>,
		public readonly error?: Error,
	) {
		super(message)
	}
}
