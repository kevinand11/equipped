import type { Pipe, PipeOutput, Prettify } from 'valleyed'
import { v } from 'valleyed'

export type FieldEntry<P extends Pipe<any, any> = Pipe<any, any>> = {
	readonly pipe: P
	readonly onCreate?: () => PipeOutput<P>
	readonly onUpdate?: () => PipeOutput<P>
}

export type AnySchema = Schema<string, string, Pipe<any, any>, Record<string, FieldEntry>>

export type SchemaOutput<S extends AnySchema> = Prettify<{
	[K in keyof SchemaFields<S>]: SchemaFields<S>[K] extends FieldEntry<infer P> ? PipeOutput<P> : never
}>

export type SchemaFields<S extends AnySchema> =
	S extends Schema<any, infer PK, infer PKPipe, infer F>
		? Prettify<Record<PK, { pipe: PKPipe; onCreate: () => PipeOutput<PKPipe> }> & F>
		: never

export class Schema<N extends string, PK extends string, PKPipe extends Pipe<any, any>, F extends Record<string, FieldEntry>> {
	#name: N
	#pkName: PK | null = null
	#pkEntry: FieldEntry<PKPipe> | null = null
	#fieldDefs: F = {} as F

	private constructor(name: N) {
		this.#name = name
	}

	pk<K extends string, P extends Pipe<any, any>>(name: K, pipe: P, generate: () => PipeOutput<P>): Schema<N, K, P, F> {
		const schema = this as unknown as Schema<N, K, P, F>
		schema.#pkName = name
		schema.#pkEntry = { pipe, onCreate: generate }
		return schema
	}

	field<
		K extends string,
		P extends Pipe<any, any>,
		O extends { onCreate?: () => PipeOutput<P>; onUpdate?: () => PipeOutput<P> } | undefined = undefined,
	>(
		name: K,
		pipe: P,
		opts?: O,
	): Schema<
		N,
		PK,
		PKPipe,
		F &
			Record<
				K,
				[O] extends [{ onCreate: () => any }]
					? { pipe: P; onCreate: () => PipeOutput<P>; onUpdate?: () => PipeOutput<P> }
					: { pipe: P; onUpdate?: () => PipeOutput<P> }
			>
	> {
		this.#fieldDefs[name] = {
			pipe,
			...(opts?.onCreate ? { onCreate: opts.onCreate } : {}),
			...(opts?.onUpdate ? { onUpdate: opts.onUpdate } : {}),
		} as any
		return this as any
	}

	get name() {
		return this.#name
	}

	get pkName() {
		if (!this.#pkName) throw new Error(`Schema "${this.#name}" does not have a primary key defined`)
		return this.#pkName
	}

	get fieldDefs(): F {
		return this.#fieldDefs
	}

	get fields() {
		return {
			...(this.#pkName ? { [this.#pkName]: this.#pkEntry } : {}),
			...this.#fieldDefs,
		} as SchemaFields<this>
	}

	static from<N extends string>(name: N) {
		return new Schema<N, never, Pipe<never, never>, Record<never, never>>(name)
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('SchemaBuilder', () => {
		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => 'generated-id')
			.field('email', v.string())
			.field('name', v.string())
			.field('age', v.optional(v.number()))
			.field('createdAt', v.number(), { onCreate: () => 1000 })
			.field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => 2000 })

		test('has correct name', () => {
			expect(UserSchema.name).toBe('users')
		})

		test('has correct pkName', () => {
			expect(UserSchema.pkName).toBe('id')
		})

		test('has correct fields keys', () => {
			expect(Object.keys(UserSchema.fields)).toEqual(['id', 'email', 'name', 'age', 'createdAt', 'updatedAt'])
		})

		test('pkGenerate returns the generated value', () => {
			expect(UserSchema.fields.id.onCreate?.()).toBe('generated-id')
		})

		test('field with onUpdate stores the function', () => {
			const entry = UserSchema.fields.updatedAt
			expect(entry.onUpdate?.()).toBe(2000)
		})

		test('pkName throws when no pk defined', () => {
			const NoKeySchema = Schema.from('nopk').field('name', v.string())
			expect(() => NoKeySchema.pkName).toThrow()
		})

		test('field with no lifecycle has undefined onCreate and onUpdate', () => {
			const entry = UserSchema.fields.email as FieldEntry
			expect(entry.onCreate).toBeUndefined()
			expect(entry.onUpdate).toBeUndefined()
		})

		test('fields object includes the pk entry', () => {
			expect(UserSchema.fields).toHaveProperty('id')
			expect(UserSchema.fields.id.pipe).toBeDefined()
		})

		test('fieldDefs excludes the pk field', () => {
			expect(Object.keys(UserSchema.fieldDefs)).not.toContain('id')
			expect(Object.keys(UserSchema.fieldDefs)).toEqual(['email', 'name', 'age', 'createdAt', 'updatedAt'])
		})
	})
}
