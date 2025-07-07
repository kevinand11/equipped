import { DataClass, Pipe, v } from 'valleyed'

import { HookCb, HookEvent, HookRecord, runHooks } from './hooks'
import { instanceSettingsPipe, mapSettingsToInstance, MapSettingsToInstance, Settings, SettingsInput } from './settings'
import { EquippedError } from '../errors'

export class Instance<S extends SettingsInput> extends DataClass<MapSettingsToInstance<S>> {
	static #instance: Instance<SettingsInput>
	static #hooks: Partial<Record<HookEvent, HookRecord[]>> = {}
	readonly settings: Readonly<Settings>

	private constructor(settings: S) {
		super(mapSettingsToInstance(settings as any))
		Instance.#instance = this as any
		this.settings = Object.freeze(settings) as any
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

	static create<S extends SettingsInput>(settings: S) {
		const settingsValidity = v.validate(instanceSettingsPipe(), settings)
		if (!settingsValidity.valid) {
			Instance.crash(
				new EquippedError(`Settings are not valid\n${settingsValidity.error.toString()}`, {
					messages: settingsValidity.error.messages,
				}),
			)
		}
		return new Instance<S>(settingsValidity.value as S)
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
}
