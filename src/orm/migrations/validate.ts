import { OrmValidationError, type OrmValidationFailure } from '../errors/validation'
import type { OrmAdapter } from '../orm-adapter'
import type { AnyMigration, AnyChange } from './types'

export function assertNormalisedChanges(adapter: OrmAdapter, migrations: ReadonlyArray<AnyMigration>): void {
	const failures: OrmValidationFailure[] = []

	const seenIds = new Set<string>()
	for (const m of migrations) {
		if (!m.id || m.id.trim() === '') {
			failures.push({ cause: 'migration id must be a non-empty string' })
			continue
		}

		if (seenIds.has(m.id)) {
			failures.push({ cause: `duplicate migration id '${m.id}'` })
		}
		seenIds.add(m.id)

		for (let i = 0; i < m.changes.length; i++) {
			const change = m.changes[i] as AnyChange
			if (change.kind === 'execute') continue

			if (change.kind === 'addIndex') {
				if (!change.table || change.table.trim() === '') {
					failures.push({ field: 'table', cause: 'table name must be non-empty' })
				}
				if (!change.on || change.on.length === 0) {
					failures.push({ field: 'on', cause: 'addIndex.on must be non-empty' })
				}

				const methodName = 'applyAddIndex'
				if (typeof (adapter as any)[methodName] !== 'function') {
					failures.push({ cause: `adapter does not support change kind '${change.kind}'` })
				}
			}
		}
	}

	if (failures.length > 0) {
		throw new OrmValidationError('changes', 'migrations', 'build', failures)
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('assertNormalisedChanges', () => {
		const adapterWithIndex = { applyAddIndex: async () => {} } as any
		const adapterWithout = {} as any

		test('passes for valid migrations', () => {
			const migrations = [
				{ id: '0001-add-idx', changes: [{ kind: 'addIndex' as const, table: 'users', on: ['email'] }] },
			]
			expect(() => assertNormalisedChanges(adapterWithIndex, migrations)).not.toThrow()
		})

		test('throws on empty migration id', () => {
			const migrations = [{ id: '', changes: [] }]
			expect(() => assertNormalisedChanges(adapterWithIndex, migrations)).toThrow(OrmValidationError)
			try {
				assertNormalisedChanges(adapterWithIndex, migrations)
			} catch (err: any) {
				expect(err.kind).toBe('changes')
				expect(err.failures).toHaveLength(1)
				expect(err.failures[0].cause).toContain('non-empty')
			}
		})

		test('throws on duplicate migration ids', () => {
			const migrations = [
				{ id: 'dup', changes: [] },
				{ id: 'dup', changes: [] },
			]
			expect(() => assertNormalisedChanges(adapterWithIndex, migrations)).toThrow(OrmValidationError)
			try {
				assertNormalisedChanges(adapterWithIndex, migrations)
			} catch (err: any) {
				expect(err.kind).toBe('changes')
				expect(err.failures.some((f: any) => f.cause.includes('duplicate'))).toBe(true)
			}
		})

		test('throws on empty addIndex.on', () => {
			const migrations = [
				{ id: '0001', changes: [{ kind: 'addIndex' as const, table: 'users', on: [] as string[] }] },
			]
			expect(() => assertNormalisedChanges(adapterWithIndex, migrations)).toThrow(OrmValidationError)
			try {
				assertNormalisedChanges(adapterWithIndex, migrations)
			} catch (err: any) {
				expect(err.failures.some((f: any) => f.cause.includes('non-empty'))).toBe(true)
			}
		})

		test('throws on empty table name in addIndex', () => {
			const migrations = [
				{ id: '0001', changes: [{ kind: 'addIndex' as const, table: '', on: ['email'] }] },
			]
			expect(() => assertNormalisedChanges(adapterWithIndex, migrations)).toThrow(OrmValidationError)
		})

		test('throws when adapter lacks required apply method', () => {
			const migrations = [
				{ id: '0001', changes: [{ kind: 'addIndex' as const, table: 'users', on: ['email'] }] },
			]
			expect(() => assertNormalisedChanges(adapterWithout, migrations)).toThrow(OrmValidationError)
			try {
				assertNormalisedChanges(adapterWithout, migrations)
			} catch (err: any) {
				expect(err.failures.some((f: any) => f.cause.includes('does not support'))).toBe(true)
			}
		})

		test('collects all failures (collect-all rule)', () => {
			const migrations = [
				{ id: '', changes: [] },
				{ id: 'dup', changes: [] },
				{ id: 'dup', changes: [{ kind: 'addIndex' as const, table: '', on: [] as string[] }] },
			]
			try {
				assertNormalisedChanges(adapterWithIndex, migrations)
			} catch (err: any) {
				expect(err.failures.length).toBeGreaterThanOrEqual(4)
			}
		})

		test('passes for execute changes without adapter check', () => {
			const migrations = [
				{ id: '0001', changes: [{ kind: 'execute' as const, up: async () => {} }] },
			]
			expect(() => assertNormalisedChanges(adapterWithout, migrations)).not.toThrow()
		})

		test('allows empty changes array (no-op baseline)', () => {
			const migrations = [{ id: '0001-baseline', changes: [] }]
			expect(() => assertNormalisedChanges(adapterWithIndex, migrations)).not.toThrow()
		})
	})
}
