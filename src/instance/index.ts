import pino, { Logger } from 'pino'
import { ConditionalObjectKeys, Pipe, PipeInput, v } from 'valleyed'

import { HookCb, HookEvent, HookRecord, runHooks } from './hooks'
import {
	cachePipe,
	CacheTypes,
	dbPipe,
	DbTypes,
	eventBusPipe,
	EventBusTypes,
	instanceSettingsPipe,
	jobsPipe,
	JobTypes,
	serverTypePipe,
	ServerTypes,
	Settings,
	SettingsInput,
} from './settings'
import { EquippedError } from '../errors'

export class Instance {
	static #instance: Instance
	static #hooks: Partial<Record<HookEvent, HookRecord[]>> = {}
	readonly settings: Readonly<Settings>
	readonly log: Logger<never>

	private constructor(settings: Settings) {
		Instance.#instance = this
		this.settings = Object.freeze(settings)
		this.log = pino<never>({
			level: this.settings.log.level,
			serializers: {
				err: pino.stdSerializers.err,
				error: pino.stdSerializers.err,
				req: pino.stdSerializers.req,
				res: pino.stdSerializers.res,
			},
		})
		Instance.#registerOnExitHandler()
	}

	getScopedName(name: string, key = '.') {
		return [this.settings.app.name, name].join(key)
	}

	async start() {
		try {
			await runHooks(Instance.#hooks['setup'] ?? [])
			await runHooks(Instance.#hooks['start'] ?? [])
		} catch (error) {
			Instance.crash(new EquippedError(`Error starting instance`, {}, error))
		}
	}

	static envs<E extends object>(envsPipe: Pipe<unknown, E>): E {
		const envValidity = v.validate(envsPipe, process.env)
		if (!envValidity.valid) {
			Instance.crash(
				new EquippedError(`Environment variables are not valid\n${envValidity.error.toString()}`, {
					messages: envValidity.error.messages,
				}),
			)
		}
		return envValidity.value
	}

	static create(settings: SettingsInput) {
		const settingsValidity = v.validate(instanceSettingsPipe(), settings)
		if (!settingsValidity.valid) {
			Instance.crash(
				new EquippedError(`Settings are not valid\n${settingsValidity.error.toString()}`, {
					messages: settingsValidity.error.messages,
				}),
			)
		}
		return new Instance(settingsValidity.value)
	}

	static get() {
		if (!Instance.#instance)
			return Instance.crash(
				new EquippedError('Has not been initialized. Make sure an instance has been created before you get an instance', {}),
			)
		return Instance.#instance
	}

	static on(event: HookEvent, cb: HookCb, order: number) {
		Instance.#hooks[event] ??= []
		Instance.#hooks[event].push({ cb, order })
	}

	static #registerOnExitHandler() {
		const signals = {
			SIGHUP: 1,
			SIGINT: 2,
			SIGTERM: 15,
		}

		Object.entries(signals).forEach(([signal, code]) => {
			process.on(signal, async () => {
				await runHooks(Instance.#hooks['close'] ?? [], () => {})
				process.exit(128 + code)
			})
		})
	}

	static resolveBeforeCrash<T>(cb: () => Promise<T>) {
		const value = cb()
		Instance.on('close', async () => await value, 10)
		return value
	}

	static crash(error: EquippedError): never {
		// eslint-disable-next-line no-console
		console.error(error)
		process.exit(1)
	}

	static createCache<T extends PipeInput<ReturnType<typeof cachePipe>>>(input: ConditionalObjectKeys<T>) {
		return v.assert(cachePipe(), input) as CacheTypes[T['type']]
	}

	static createJobs<T extends PipeInput<ReturnType<typeof jobsPipe>>>(input: ConditionalObjectKeys<T>) {
		return v.assert(jobsPipe(), input) as JobTypes[T['type']]
	}

	static createEventBus<T extends PipeInput<ReturnType<typeof eventBusPipe>>>(input: ConditionalObjectKeys<T>) {
		return v.assert(eventBusPipe(), input) as EventBusTypes[T['type']]
	}

	static createDb<T extends PipeInput<ReturnType<typeof dbPipe>>>(input: ConditionalObjectKeys<T>) {
		return v.assert(dbPipe(), input) as DbTypes[T['db']['type']]
	}

	createServer<T extends PipeInput<ReturnType<typeof serverTypePipe>>>(input: ConditionalObjectKeys<T>) {
		return v.assert(serverTypePipe(), input) as ServerTypes[T['type']]
	}
}
