import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

type CtorParams<T> = ConstructorParameters<T & (abstract new (...args: any[]) => any)>

export function configurable<P extends Pipe<any, any>, Base extends new (...args: any[]) => any>(pipeFn: () => P, base: Base) {
	let pipe: P | undefined

	abstract class Configurable extends (base as new (...args: any[]) => any) {
		declare static readonly Config: PipeOutput<P>

		protected readonly config: PipeOutput<P>

		protected constructor(validated: PipeOutput<P>, ...baseArgs: ConstructorParameters<Base>) {
			// eslint-disable-next-line constructor-super
			super(...baseArgs)
			this.config = validated
		}

		static create<This extends Function & { prototype: any }>(
			this: This,
			input: PipeInput<P>,
			...args: CtorParams<This> extends [PipeOutput<P>, ...infer R] ? R : never
		): This['prototype'] {
			if (!pipe) {
				pipe = pipeFn()
				v.compile(pipe)
			}
			const validated = v.assert(pipe, input)
			return new (this as any)(validated, ...args) as This['prototype']
		}
	}

	return Configurable as unknown as (abstract new (validated: PipeOutput<P>, ...baseArgs: ConstructorParameters<Base>) => InstanceType<Base> & { readonly config: PipeOutput<P> }) & {
		readonly Config: PipeOutput<P>
		create<This extends Function & { prototype: any }>(
			this: This,
			input: PipeInput<P>,
			...args: CtorParams<This> extends [PipeOutput<P>, ...infer R] ? R : never
		): This['prototype']
	}
}

/** @deprecated Use class-based `configurable` instead. Will be removed when server adapters migrate. */
export function configurableFn<P extends Pipe<any, any>, T, Args extends ReadonlyArray<any>>(
	pipeFn: () => P,
	fn: (config: PipeOutput<P>, ...args: Args) => T,
): { create: (config: PipeInput<P>, ...args: Args) => T } {
	const pipe = pipeFn()
	v.compile(pipe)
	return {
		create: (config: PipeInput<P>, ...args: Args) => {
			const validated = v.assert(pipe, config)
			return fn(validated, ...args)
		},
	}
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf } = import.meta.vitest
	const { v } = await import('valleyed')

	const testPipe = () =>
		v.object({
			host: v.string(),
			port: v.number(),
		})

	type TestConfig = PipeOutput<ReturnType<typeof testPipe>>

	class TestBase {
		baseValue: string
		constructor() {
			this.baseValue = 'base'
		}
	}

	class TestBaseWithArgs {
		label: string
		constructor(label: string) {
			this.label = label
		}
	}

	describe('configurable', () => {
		test('validation runs in static create before constructor body executes', () => {
			let constructorRan = false

			const Wrapped = configurable(testPipe, TestBase)
			class MyClass extends Wrapped {
				protected constructor(config: typeof MyClass.Config) {
					super(config)
					constructorRan = true
				}
			}

			expect(() => MyClass.create({ host: 123, port: 'bad' } as any)).toThrow()
			expect(constructorRan).toBe(false)

			MyClass.create({ host: 'localhost', port: 3000 })
			expect(constructorRan).toBe(true)
		})

		test('constructor receives validated value', () => {
			const Wrapped = configurable(testPipe, TestBase)
			let receivedConfig: unknown

			class MyClass extends Wrapped {
				protected constructor(config: typeof MyClass.Config) {
					super(config)
					receivedConfig = this.config
				}
			}

			MyClass.create({ host: 'localhost', port: 3000 })

			expect(receivedConfig).toEqual({ host: 'localhost', port: 3000 })
		})

		test('external new is a compile error', () => {
			const Wrapped = configurable(testPipe, TestBase)
			class MyClass extends Wrapped {
				protected constructor(config: typeof MyClass.Config) {
					super(config)
				}
			}

			// @ts-expect-error — external `new` on a class with protected constructor is a compile error
			void (() => new MyClass({ host: 'localhost', port: 3000 }))
		})

		test('static Config resolves to PipeOutput<P> at the type level', () => {
			const Wrapped = configurable(testPipe, TestBase)
			class MyClass extends Wrapped {
				protected constructor(config: typeof MyClass.Config) {
					super(config)
				}
			}

			expectTypeOf<typeof MyClass.Config>().toEqualTypeOf<TestConfig>()
			expect(MyClass.create).toBeTypeOf('function')
		})

		test('ConstructorParameters<This>-based extras inference works for non-zero-arg leaf signatures', () => {
			const Wrapped = configurable(testPipe, TestBase)
			class MyClass extends Wrapped {
				extra: number
				protected constructor(config: typeof MyClass.Config, extra: number) {
					super(config)
					this.extra = extra
				}
			}

			const instance = MyClass.create({ host: 'localhost', port: 3000 }, 42)

			expect(instance.extra).toBe(42)
			expectTypeOf(instance).toHaveProperty('extra')
			expectTypeOf(instance.extra).toEqualTypeOf<number>()

			// @ts-expect-error — wrong extra type
			void (() => MyClass.create({ host: 'localhost', port: 3000 }, 'not-a-number'))
		})

		test('base-args forwarding works for non-zero-arg bases', () => {
			const Wrapped = configurable(testPipe, TestBaseWithArgs)
			class MyClass extends Wrapped {
				protected constructor(config: typeof MyClass.Config, label: string) {
					super(config, label)
				}
			}

			const instance = MyClass.create({ host: 'localhost', port: 3000 }, 'test-label')

			expect(instance.label).toBe('test-label')
		})

		test('config is accessible as protected readonly on instances', () => {
			const Wrapped = configurable(testPipe, TestBase)
			class MyClass extends Wrapped {
				protected constructor(config: typeof MyClass.Config) {
					super(config)
				}

				getHost() {
					return this.config.host
				}
			}

			const instance = MyClass.create({ host: 'localhost', port: 3000 })
			expect(instance.getHost()).toBe('localhost')
		})
	})
}
