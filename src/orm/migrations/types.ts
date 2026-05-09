import type { OrmAdapterLike } from '../adapters/base'
import type { OrmAdapter } from '../orm-adapter'
import type { Repo } from '../repo/repo'

export type FieldSpec<A extends OrmAdapter> = {
	name: string
	type: A['supportedFieldTypes'][number]
	nullable?: boolean
	default?: string | number | boolean | null
	unique?: boolean
}

export type AddIndexChange = {
	kind: 'addIndex'
	table: string
	on: ReadonlyArray<string>
	unique?: boolean
	name?: string
}

export type ExecuteChange<A extends OrmAdapterLike<any> = OrmAdapterLike<any>> = {
	kind: 'execute'
	up: (repo: Repo<A>) => Promise<void>
}

export type Change<A extends OrmAdapterLike<any> = OrmAdapterLike<any>> =
	| AddIndexChange
	| ExecuteChange<A>

export type AnyChange = Change<OrmAdapterLike<any>>

export type ApplyMethodKey<A> = Extract<keyof A, `apply${string}`>
export type KindFromMethod<M> = M extends `apply${infer K}` ? Uncapitalize<K> : never
export type ChangeKindFor<A> = KindFromMethod<ApplyMethodKey<A>> | 'execute'
export type ChangeFor<A extends OrmAdapterLike<any>> = Extract<Change<A>, { kind: ChangeKindFor<A> }>

export type AnyMigration = {
	id: string
	changes: ReadonlyArray<AnyChange>
	tx?: boolean
}

export type Migration<A extends OrmAdapterLike<any>> = {
	id: string
	changes: ReadonlyArray<ChangeFor<A>>
	tx?: boolean
}
