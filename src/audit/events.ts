import { ulid } from 'ulid'
import { Pipe, PipeInput, PipeOutput, v } from 'valleyed'

import { Conditions, Db, Table, wrapQueryParams } from '../dbs'
import { EquippedError } from '../errors'

export type EventDefinition<T extends string, P, R> = {
	type: T
	pipe: Pipe<any, P>
	handle: (payload: P, context: { idempotencyKey: string; idempotencyDate: Date }) => Promise<R>
}

export type EventDoc<T extends string, P> = {
	key: string
	type: T
	ts: number
	payload: P
	mode: 'sync' | 'async'
	status: 'pending' | 'processing' | 'done' | 'failed'
	error: string | null
	startedAt: number | null
	completedAt: number | null
}

export class EventAudit<E extends Record<string, EventDefinition<string, any, any>>> {
	private table: Table<any, EventDoc<string, any>, EventDoc<string, any> & { toJSON: () => Record<string, unknown> }, any>

	constructor(
		private db: Db<any>,
		dbName: string,
		private handlers: E,
	) {
		this.table = db.use({
			db: dbName,
			col: '__audits',
			mapper: (model) => ({ ...model, toJSON: () => model as Record<string, unknown> }),
			options: { skipAudit: true },
		})
		for (const key in handlers) v.compile(handlers[key]!.pipe)
	}

	async #createEvent<K extends keyof E & string>(type: K, payload: PipeInput<E[K]['pipe']>, mode: 'sync' | 'async') {
		const handler = this.handlers[type]
		if (!handler) throw new EquippedError('audit handler not found', { type, payload, mode })

		const validPayload = v.assert(handler.pipe, payload)
		const key = this.createId()
		const now = new Date()

		const audit = await this.table.insertOne(
			{
				key,
				type,
				mode,
				ts: now.getTime(),
				payload: validPayload,
				status: 'pending',
				error: null,
				startedAt: null,
				completedAt: null,
			},
			{ getTime: () => now, makeId: () => key },
		)
		return audit as unknown as EventDoc<K, PipeOutput<E[K]['pipe']>>
	}

	async #processEvent<K extends keyof E & string>(event: EventDoc<K, PipeOutput<E[K]['pipe']>>) {
		type HandlerResult = E[K] extends EventDefinition<string, any, infer R> ? R : never
		return this.db.session(async () => {
			const handler = this.handlers[event.type]
			if (!handler) throw new EquippedError('audit handler not found', { event })
			try {
				await this.table.updateOne(
					{ key: event.key },
					{ $set: { status: 'processing', startedAt: Date.now(), completedAt: null, error: null } },
				)
				const result = await handler.handle(event.payload, {
					idempotencyKey: event.key.toString(),
					idempotencyDate: new Date(event.ts),
				})
				await this.table.updateOne({ key: event.key }, { $set: { status: 'done', completedAt: Date.now() } })
				return result as HandlerResult
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				await this.table.updateOne({ key: event.key }, { $set: { status: 'failed', error: message, completedAt: Date.now() } })
				throw err
			}
		})
	}

	async createSync<K extends keyof E & string>(type: K, payload: PipeInput<E[K]['pipe']>) {
		const event = await this.#createEvent(type, payload, 'sync')
		return this.#processEvent(event)
	}

	async createAsync<K extends keyof E & string>(type: K, payload: PipeInput<E[K]['pipe']>) {
		const event = await this.#createEvent(type, payload, 'async')
		this.#processEvent(event).catch(() => {})
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

	createId() {
		return ulid()
	}

	static defineHandler<T extends string, P, R>(type: T, def: Omit<EventDefinition<T, P, R>, 'type'>) {
		return { ...def, type }
	}
}
