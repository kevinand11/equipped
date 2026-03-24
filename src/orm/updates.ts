export class IncOp {
	constructor(readonly by: number) {}
}
export class MulOp {
	constructor(readonly by: number) {}
}
export class MinOp<T = unknown> {
	constructor(readonly value: T) {}
}
export class MaxOp<T = unknown> {
	constructor(readonly value: T) {}
}
export class UnsetOp {}
export class PushOp<T = unknown> {
	constructor(readonly value: T) {}
}
export class PullOp<T = unknown> {
	constructor(readonly value: T) {}
}
export class PatchOp<T = unknown> {
	constructor(
		readonly path: string[],
		readonly value: T,
	) {}
}

export type AnyUpdateOp = IncOp | MulOp | MinOp | MaxOp | UnsetOp | PushOp | PullOp | PatchOp

export function isUpdateOp(v: unknown): v is AnyUpdateOp {
	return (
		v instanceof IncOp ||
		v instanceof MulOp ||
		v instanceof MinOp ||
		v instanceof MaxOp ||
		v instanceof UnsetOp ||
		v instanceof PushOp ||
		v instanceof PullOp ||
		v instanceof PatchOp
	)
}

export const inc = (by: number) => new IncOp(by)
export const mul = (by: number) => new MulOp(by)
export const min = <T>(value: T) => new MinOp(value)
export const max = <T>(value: T) => new MaxOp(value)
export const unset = () => new UnsetOp()
export const push = <T>(value: T) => new PushOp(value)
export const pull = <T>(value: T) => new PullOp(value)
export const patch = <T>(path: string[], value: T) => new PatchOp(path, value)

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('update ops', () => {
		describe('op classes', () => {
			test('IncOp stores by', () => {
				expect(new IncOp(5).by).toBe(5)
			})
			test('MulOp stores by', () => {
				expect(new MulOp(3).by).toBe(3)
			})
			test('MinOp stores value', () => {
				expect(new MinOp(10).value).toBe(10)
			})
			test('MaxOp stores value', () => {
				expect(new MaxOp(99).value).toBe(99)
			})
			test('UnsetOp is an instance of UnsetOp', () => {
				expect(new UnsetOp()).toBeInstanceOf(UnsetOp)
			})
			test('PushOp stores value', () => {
				expect(new PushOp('item').value).toBe('item')
			})
			test('PullOp stores value', () => {
				expect(new PullOp('item').value).toBe('item')
			})
			test('PatchOp stores path and value', () => {
				const op = new PatchOp(['a', 'b'], 42)
				expect(op.path).toEqual(['a', 'b'])
				expect(op.value).toBe(42)
			})
		})

		describe('isUpdateOp', () => {
			test('returns true for every op class', () => {
				expect(isUpdateOp(new IncOp(1))).toBe(true)
				expect(isUpdateOp(new MulOp(2))).toBe(true)
				expect(isUpdateOp(new MinOp(0))).toBe(true)
				expect(isUpdateOp(new MaxOp(10))).toBe(true)
				expect(isUpdateOp(new UnsetOp())).toBe(true)
				expect(isUpdateOp(new PushOp('v'))).toBe(true)
				expect(isUpdateOp(new PullOp('v'))).toBe(true)
				expect(isUpdateOp(new PatchOp(['k'], 1))).toBe(true)
			})
			test('returns false for non-op values', () => {
				expect(isUpdateOp('string')).toBe(false)
				expect(isUpdateOp(42)).toBe(false)
				expect(isUpdateOp(null)).toBe(false)
				expect(isUpdateOp({})).toBe(false)
				expect(isUpdateOp(undefined)).toBe(false)
			})
		})

		describe('factory functions', () => {
			test('inc() creates IncOp with by', () => {
				const op = inc(2)
				expect(op).toBeInstanceOf(IncOp)
				expect(op.by).toBe(2)
			})
			test('mul() creates MulOp with by', () => {
				const op = mul(3)
				expect(op).toBeInstanceOf(MulOp)
				expect(op.by).toBe(3)
			})
			test('min() creates MinOp with value', () => {
				const op = min(0)
				expect(op).toBeInstanceOf(MinOp)
				expect(op.value).toBe(0)
			})
			test('max() creates MaxOp with value', () => {
				const op = max(100)
				expect(op).toBeInstanceOf(MaxOp)
				expect(op.value).toBe(100)
			})
			test('unset() creates UnsetOp', () => {
				expect(unset()).toBeInstanceOf(UnsetOp)
			})
			test('push() creates PushOp with value', () => {
				const op = push('x')
				expect(op).toBeInstanceOf(PushOp)
				expect(op.value).toBe('x')
			})
			test('pull() creates PullOp with value', () => {
				const op = pull('x')
				expect(op).toBeInstanceOf(PullOp)
				expect(op.value).toBe('x')
			})
			test('patch() creates PatchOp with path and value', () => {
				const op = patch(['key', 'nested'], 'val')
				expect(op).toBeInstanceOf(PatchOp)
				expect(op.path).toEqual(['key', 'nested'])
				expect(op.value).toBe('val')
			})
		})
	})
}
