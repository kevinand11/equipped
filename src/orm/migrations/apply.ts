import type { OrmAdapterLike } from '../adapters/base'
import type { OrmAdapter } from '../orm-adapter'
import type { AnyChange } from './types'
import type { Repo } from '../repo/repo'

export async function applyChange(adapter: OrmAdapter, repo: Repo<OrmAdapterLike<any>>, change: AnyChange): Promise<void> {
	if (change.kind === 'execute') {
		await change.up(repo)
		return
	}

	const methodName = `apply${change.kind[0].toUpperCase()}${change.kind.slice(1)}`
	const method = (adapter as any)[methodName]
	if (typeof method !== 'function') {
		throw new Error(`Adapter does not support change kind '${change.kind}'`)
	}
	await method.call(adapter, change)
}

if (import.meta.vitest) {
	const { describe, test, expect, vi } = import.meta.vitest

	describe('applyChange', () => {
		test('routes addIndex to adapter.applyAddIndex', async () => {
			const applyAddIndex = vi.fn().mockResolvedValue(undefined)
			const adapter = { applyAddIndex } as any
			const repo = {} as any
			await applyChange(adapter, repo, { kind: 'addIndex', table: 'users', on: ['email'] })
			expect(applyAddIndex).toHaveBeenCalledWith({ kind: 'addIndex', table: 'users', on: ['email'] })
		})

		test('routes execute to change.up(repo)', async () => {
			const up = vi.fn().mockResolvedValue(undefined)
			const adapter = {} as any
			const repo = {} as any
			await applyChange(adapter, repo, { kind: 'execute', up })
			expect(up).toHaveBeenCalledWith(repo)
		})

		test('throws when adapter lacks the apply method for a declarative change', async () => {
			const adapter = {} as any
			const repo = {} as any
			await expect(applyChange(adapter, repo, { kind: 'addIndex', table: 't', on: ['a'] }))
				.rejects.toThrow("Adapter does not support change kind 'addIndex'")
		})
	})
}
