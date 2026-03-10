import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

type Configurable<Input, T, Args extends ReadonlyArray<any>> = {
	create: (config: Input, ...args: Args) => T
}

export function configurable<P extends Pipe<any, any>, T, Args extends ReadonlyArray<any>>(
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
