import { Pipe, PipeInput, PipeOutput, v } from 'valleyed'

import { Conditions, Db, Table, wrapQueryParams } from '../dbs'
import { EquippedError } from '../errors'
import { Instance } from '../instance'

export type EventDefinition<P extends Pipe<any, any>, R> = {
	pipe: P
	handle: (payload: PipeOutput<P>, context: EventContext) => R | Promise<R>
}

export type EventContext = {
	key: string
	userId: string | null
	date: Date
}

export type EventDoc = {
	key: string
	type: string
	ts: number
	payload: unknown
	mode: 'sync' | 'async'
	status: 'pending' | 'processing' | 'done' | 'failed'
	userId: string | null
	error: string | null
	startedAt: number | null
	completedAt: number | null
}
type Context = { userId?: string }

export class EventAudit {
	private table: Table<any, EventDoc, EventDoc & { toJSON: () => Record<string, unknown> }, any>
	private handles: Record<string, EventDefinition<any, any>> = {}

	constructor(
		private db: Db<any>,
		dbName: string,
	) {
		this.table = db.use({
			db: dbName,
			col: '__audits',
			mapper: (model) => ({ ...model, toJSON: () => model as Record<string, unknown> }),
			options: { skipAudit: true },
		})
	}

	async #createEvent(type: string, payload: unknown, mode: 'sync' | 'async', context: Context) {
		const handler = this.handles[type]
		if (!handler) throw new EquippedError('audit handler not found', { type, payload, mode })

		const validPayload = v.assert(handler.pipe, payload)
		const key = Instance.createId()
		const now = new Date()

		return await this.table.insertOne(
			{
				key,
				type,
				mode,
				ts: now.getTime(),
				payload: validPayload,
				status: 'pending',
				userId: context.userId ?? null,
				error: null,
				startedAt: null,
				completedAt: null,
			},
			{ getTime: () => now, makeId: () => key },
		)
	}

	async #processEvent<R>(event: EventDoc) {
		return this.db.session(async () => {
			const handler = this.handles[event.type]
			if (!handler) throw new EquippedError('audit handler not found', { event })
			try {
				await this.table.updateOne(
					{ key: event.key },
					{ $set: { status: 'processing', startedAt: Date.now(), completedAt: null, error: null } },
				)
				const result = await handler.handle(event.payload, {
					key: event.key,
					userId: event.userId,
					date: new Date(event.ts),
				})
				await this.table.updateOne({ key: event.key }, { $set: { status: 'done', completedAt: Date.now() } })
				return result as R
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				await this.table.updateOne({ key: event.key }, { $set: { status: 'failed', error: message, completedAt: Date.now() } })
				throw err
			}
		})
	}

	async replay(from?: Date) {
		const { results: events } = await this.table.query(
			wrapQueryParams({
				where: [...(from ? [{ field: 'ts', value: from.getTime(), condition: Conditions.gte }] : [])],
				sort: [{ field: 'ts', desc: false }],
				all: true,
			}),
		)
		for (const event of events) await this.#processEvent(event)
	}

	async rerun(key: string) {
		const event = await this.table.findOne({ key })
		if (!event) throw new EquippedError('audit event not found', { key })
		await this.#processEvent(event)
	}

	register<P extends Pipe<any, any>, R>(type: string, handle: EventDefinition<P, R>) {
		if (this.handles[type]) throw new EquippedError(`${type} already has a registered handler`, {})
		this.handles[type] = handle
		v.compile(handle.pipe)
		return {
			sync: async (payload: PipeInput<P>, context: Context) => {
				const event = await this.#createEvent(type, payload, 'sync', context)
				return this.#processEvent<R>(event)
			},
			async: async (payload: PipeInput<P>, context: Context) => {
				const event = await this.#createEvent(type, payload, 'async', context)
				this.#processEvent<R>(event).catch(() => {})
			},
		}
	}
}
