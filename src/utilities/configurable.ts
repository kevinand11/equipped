import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

type Configurable<Input, T, Args extends ReadonlyArray<any>> = {
	create: (config: Input, ...args: Args) => T
}

export function configurableFn<P extends Pipe<any, any>, T, Args extends ReadonlyArray<any>>(
	pipeFn: () => P,
	fn: (config: PipeOutput<P>, ...args: Args) => T,
): Configurable<PipeInput<P>, T, Args> {
	const pipe = pipeFn()
	v.compile(pipe)
	return {
		create: (config: PipeInput<P>, ...args: Args) => {
			const validated = v.assert(pipe, config)
			return fn(validated, ...args)
		},
	}
}

export function configurable<
	P extends Pipe<any, any>,
	Args extends ReadonlyArray<any>,
	Cls extends new (config: PipeOutput<P>, ...args: Args) => any,
>(pipeFn: () => P, baseClass: Cls) {
	const pipe = pipeFn()
	v.compile(pipe)
	// @ts-expect-error - mixin error
	return class Configurable extends baseClass {
		constructor(...args) {
			// @ts-expect-error - mixin error
			super(...args)
		}

		static create<C extends typeof Configurable>(this: C, input: PipeInput<P>, ...args: Args) {
			const output = v.assert(pipe, input)
			return new this(output, ...args) as InstanceType<C>
		}
	}
}
