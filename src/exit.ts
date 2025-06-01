import { EquippedError } from './errors'

const listeners: any[] = []

export const addWaitBeforeExit = (fn: any) => {
	listeners.unshift(fn)
}

export const exit = (error: EquippedError): never => {
	// eslint-disable-next-line no-console
	console.error(error)
	process.exit(1)
}

const signals = {
	SIGHUP: 1,
	SIGINT: 2,
	SIGTERM: 15,
}

Object.entries(signals).forEach(([signal, code]) => {
	process.on(signal, async () => {
		await Promise.all(
			listeners.map(async (l) => {
				try {
					typeof l === 'function' ? await l() : await l
					// eslint-disable-next-line no-empty
				} catch {}
			}),
		)
		process.exit(128 + code)
	})
})
