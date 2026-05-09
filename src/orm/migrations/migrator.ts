import type { OrmAdapterLike } from '../adapters/base'
import { OrmMigrationError } from '../errors/migration'
import type { OrmAdapter } from '../orm-adapter'
import { applyChange } from './apply'
import { computePending } from './pending'
import type { AnyChange, AnyMigration, Migration } from './types'
import { assertNormalisedChanges } from './validate'
import type { Repo } from '../repo/repo'

type RunResult = { ran: string[]; skipped: string[] }

export class Migrator<A extends OrmAdapterLike<any>> {
	readonly #repo: Repo<A>
	readonly #adapter: OrmAdapter
	readonly #migrations: ReadonlyArray<Migration<A>>

	constructor(repo: Repo<A>, adapter: OrmAdapter, migrations: ReadonlyArray<Migration<A>>) {
		this.#repo = repo
		this.#adapter = adapter
		this.#migrations = migrations
	}

	async up(): Promise<RunResult> {
		if (typeof this.#adapter.loadMigrations !== 'function') {
			throw new OrmMigrationError({ id: '', phase: 'load', cause: 'adapter does not implement loadMigrations' })
		}
		if (typeof this.#adapter.recordMigration !== 'function') {
			throw new OrmMigrationError({ id: '', phase: 'record', cause: 'adapter does not implement recordMigration' })
		}

		let applied: { id: string; appliedAt: number }[]
		try {
			applied = await this.#adapter.loadMigrations()
		} catch (err) {
			throw new OrmMigrationError({ id: '', phase: 'load', cause: err })
		}

		const { pending, skipped } = computePending(this.#migrations as unknown as ReadonlyArray<AnyMigration>, applied)
		const ran: string[] = []

		for (const m of pending) {
			const execute = async () => {
				for (const c of m.changes) {
					try {
						await applyChange(this.#adapter, this.#repo as unknown as Repo<OrmAdapterLike<any>>, c as AnyChange)
					} catch (err) {
						throw new OrmMigrationError({ id: m.id, phase: 'user', cause: err })
					}
				}
				try {
					await this.#adapter.recordMigration!(m.id, Date.now())
				} catch (err) {
					throw new OrmMigrationError({ id: m.id, phase: 'record', cause: err })
				}
			}

			const shouldWrapInSession = m.tx !== false && typeof this.#adapter.session === 'function'
			if (shouldWrapInSession) {
				try {
					await this.#repo.session(execute)
				} catch (err) {
					if (err instanceof OrmMigrationError) throw err
					throw new OrmMigrationError({ id: m.id, phase: 'session', cause: err })
				}
			} else {
				await execute()
			}

			ran.push(m.id)
		}

		return { ran, skipped }
	}

	static from<A extends OrmAdapterLike<any>>(repo: Repo<A>, adapter: A & OrmAdapter) {
		return {
			migrations(migrations: ReadonlyArray<Migration<A>>) {
				return {
					build(): Migrator<A> {
						assertNormalisedChanges(adapter, migrations as any)
						return new Migrator(repo, adapter, migrations)
					},
				}
			},
		}
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { InMemoryAdapter } = await import('../adapters/in-memory')
	const { Schema } = await import('../schema')
	const { Repo } = await import('../repo/repo')
	const { OrmValidationError } = await import('../errors/validation')
	const { OrmMigrationError } = await import('../errors/migration')

	const UserSchema = Schema.from('users')
		.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2)}`)
		.field('email', v.string())
		.build()

	function makeEnv() {
		const adapter = InMemoryAdapter.create({})
		const repo = new Repo({ adapter, resolve: (s) => ({ table: s.name }) })
		return { adapter, repo }
	}

	describe('Migrator', () => {
		test('addIndex migration applies and is recorded', async () => {
			const { adapter, repo } = makeEnv()
			const m: Migration<typeof adapter> = {
				id: '0001-add-email-idx',
				changes: [{ kind: 'addIndex', table: 'users', on: ['email'], unique: true }],
			}
			const migrator = Migrator.from(repo, adapter).migrations([m]).build()
			const result = await migrator.up()
			expect(result.ran).toEqual(['0001-add-email-idx'])
			expect(result.skipped).toEqual([])

			expect(adapter.indexes.has('users_email_idx')).toBe(true)
			const idx = adapter.indexes.get('users_email_idx')!
			expect(idx.table).toBe('users')
			expect(idx.on).toEqual(['email'])
			expect(idx.unique).toBe(true)

			const recorded = await adapter.loadMigrations()
			expect(recorded).toHaveLength(1)
			expect(recorded[0].id).toBe('0001-add-email-idx')
		})

		test('execute migration runs user code with the same Repo', async () => {
			const { adapter, repo } = makeEnv()
			const m: Migration<typeof adapter> = {
				id: '0001-seed-user',
				changes: [{
					kind: 'execute',
					up: async (r) => {
						await r.on(UserSchema).one().create({ id: 'seed-1', email: 'test@example.com' })
					},
				}],
			}
			const migrator = Migrator.from(repo, adapter).migrations([m]).build()
			await migrator.up()

			const row = await repo.on(UserSchema).one().id('seed-1').find()
			expect(row).not.toBeNull()
			expect(row!.email).toBe('test@example.com')
		})

		test('duplicate id throws OrmValidationError at build()', () => {
			const { adapter, repo } = makeEnv()
			expect(() =>
				Migrator.from(repo, adapter)
					.migrations([
						{ id: 'dup', changes: [] },
						{ id: 'dup', changes: [] },
					])
					.build(),
			).toThrow(OrmValidationError)

			try {
				Migrator.from(repo, adapter)
					.migrations([
						{ id: 'dup', changes: [] },
						{ id: 'dup', changes: [] },
					])
					.build()
			} catch (err: any) {
				expect(err.kind).toBe('changes')
			}
		})

		test('up() skips already-applied migrations', async () => {
			const { adapter, repo } = makeEnv()
			const m1: Migration<typeof adapter> = { id: '0001', changes: [] }
			const m2: Migration<typeof adapter> = {
				id: '0002',
				changes: [{ kind: 'addIndex', table: 'users', on: ['email'] }],
			}

			await adapter.recordMigration('0001', Date.now())

			const migrator = Migrator.from(repo, adapter).migrations([m1, m2]).build()
			const result = await migrator.up()
			expect(result.ran).toEqual(['0002'])
			expect(result.skipped).toEqual(['0001'])
		})

		test('up() returns empty ran when all applied', async () => {
			const { adapter, repo } = makeEnv()
			await adapter.recordMigration('0001', Date.now())
			const migrator = Migrator.from(repo, adapter).migrations([{ id: '0001', changes: [] }]).build()
			const result = await migrator.up()
			expect(result.ran).toEqual([])
			expect(result.skipped).toEqual(['0001'])
		})

		test('failed migration rolls back via session and throws OrmMigrationError', async () => {
			const { adapter, repo } = makeEnv()
			const m1: Migration<typeof adapter> = {
				id: '0001',
				changes: [{ kind: 'addIndex', table: 'users', on: ['email'] }],
			}
			const m2: Migration<typeof adapter> = {
				id: '0002',
				changes: [{
					kind: 'execute',
					up: async () => { throw new Error('boom') },
				}],
			}
			const migrator = Migrator.from(repo, adapter).migrations([m1, m2]).build()
			await expect(migrator.up()).rejects.toThrow(OrmMigrationError)

			const recorded = await adapter.loadMigrations()
			expect(recorded.map((r) => r.id)).toEqual(['0001'])
		})

		test('multiple changes in one migration all apply', async () => {
			const { adapter, repo } = makeEnv()
			const m: Migration<typeof adapter> = {
				id: '0001-multi',
				changes: [
					{ kind: 'addIndex', table: 'users', on: ['email'], unique: true },
					{ kind: 'addIndex', table: 'users', on: ['id', 'email'], name: 'users_compound_idx' },
				],
			}
			const migrator = Migrator.from(repo, adapter).migrations([m]).build()
			await migrator.up()

			expect(adapter.indexes.size).toBe(2)
			expect(adapter.indexes.has('users_email_idx')).toBe(true)
			expect(adapter.indexes.has('users_compound_idx')).toBe(true)
		})

		test('lex-sorts migrations by id before running', async () => {
			const { adapter, repo } = makeEnv()
			const order: string[] = []
			const m1: Migration<typeof adapter> = {
				id: '0002',
				changes: [{ kind: 'execute', up: async () => { order.push('0002') } }],
			}
			const m2: Migration<typeof adapter> = {
				id: '0001',
				changes: [{ kind: 'execute', up: async () => { order.push('0001') } }],
			}
			const migrator = Migrator.from(repo, adapter).migrations([m1, m2]).build()
			await migrator.up()
			expect(order).toEqual(['0001', '0002'])
		})
	})
}
