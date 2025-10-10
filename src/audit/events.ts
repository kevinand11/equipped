import { Pipe, PipeInput, PipeOutput, v } from 'valleyed'

import { Conditions, Db, Table, wrapQueryParams } from '../dbs'
import { EquippedError } from '../errors'
import { Instance } from '../instance'

export type EventDefinition<P extends Pipe<any, any>, R> = {
	pipe: P
	handle: (payload: PipeOutput<P>, context: EventContext) => R | Promise<R>
	sync?: (result: R, payload: PipeOutput<P>, context: EventContext) => void
	async?: (result: R, payload: PipeOutput<P>, context: EventContext) => void
}

export type EventContext = {
	key: string
	by: string | undefined
	date: Date
}

export type EventDoc = {
	key: string
	name: string
	ts: number
	body: unknown
	steps: { status: 'start' | 'sync' | 'async' | 'error', ts: number, error?: string }[]
	by?: string
}
type Context = { by?: string; at?: Date; }

function createStep (step: EventDoc['steps'][number]) {
	return step
}

export class EventAudit {
	private table: Table<any, EventDoc, EventDoc & { toJSON: () => Record<string, unknown> }, any>
	private definitions: Record<string, EventDefinition<any, any>> = {}
	private asyncQueue: (() => Promise<void>)[] = []

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

	async #createEvent(name: string, payload: unknown, context: Context) {
		const def = this.definitions[name]
		if (!def) throw new EquippedError('audit definition not found', { name, payload })

		const validBody = v.assert(def.pipe, payload)
		const ts = context.at ?? new Date()
		const key = Instance.createId(ts)

		return await this.table.insertOne(
			{
				key,
				name,
				ts: ts.getTime(),
				body: validBody,
				by: context.by,
				steps: []
			},
			{ getTime: () => ts, makeId: () => key },
		)
	}

	async #processEvent<R>(event: EventDoc, callbackWait: boolean) {
		return this.db.session(async () => {
			const def = this.definitions[event.name]
			if (!def) throw new EquippedError('audit definition not found', { event })
			try {
				await this.table.updateOne(
					{ key: event.key },
					{ $set: { steps: [createStep({ status: 'start', ts: Date.now() })] } },
				)
				const context: EventContext = {
					key: event.key,
					by: event.by,
					date: new Date(event.ts),
				}
				const result = await def.handle(event.body, context)
				await def.sync?.(result, event.body, context)
				await this.table.updateOne({ key: event.key }, { $push: { steps: createStep({ status: 'sync', ts: Date.now() }) } })

				const asyncHandle = async () => {
					try {
						await def.async?.(result, event.body, context)
						await this.table.updateOne({ key: event.key }, { $push: { steps: createStep({ status: 'async', ts: Date.now() }) } })
					} catch(err) {
						const error = err instanceof Error ? err.message : String(err)
						await this.table.updateOne({ key: event.key }, { $push: { steps: createStep({ status: 'error', error, ts: Date.now() }) } })
					};
				}
				if (callbackWait) await asyncHandle()
				else this.asyncQueue.push(asyncHandle)
				return result as R
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err)
				await this.table.updateOne({ key: event.key }, { $push: { steps: createStep({ status: 'error', error, ts: Date.now() }) } })
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
		for (const event of events) await this.#processEvent(event, true)
	}

	async rerun(key: string) {
		const event = await this.table.findOne({ key })
		if (!event) throw new EquippedError('audit event not found', { key })
		await this.#processEvent(event, true)
	}

	register<P extends Pipe<any, any>, R>(name: string, def: EventDefinition<P, R>) {
		if (this.definitions[name]) throw new EquippedError(`${name} already has a registered handler`, {})
		this.definitions[name] = def
		v.compile(def.pipe)
		return async (payload: PipeInput<P>, context: Context)=> {
			const event = await this.#createEvent(name, payload, context)
			return this.#processEvent<R>(event, false)
		}
	}

	start () {
		setInterval(async () => {
			const queue = [...this.asyncQueue]
			this.asyncQueue = []
			await Promise.all(queue.map((job) => job()))
		}, 200)
	}
}
