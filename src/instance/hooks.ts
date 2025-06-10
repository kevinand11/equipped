export type HookEvent = 'pre:start' | 'post:start' | 'pre:close' | 'post:close'
export type HookCb = Promise<unknown | void> | (() => void | unknown | Promise<void | unknown>)
export type HookRecord = { cb: HookCb; order: number }

export async function runHooks(
	hooks: HookRecord[],
	onError: (error: Error) => void = (error) => {
		throw error
	},
) {
	const grouped = hooks.reduce<Record<string, HookRecord[]>>((acc, cur) => {
		const key = cur.order.toString()
		if (!acc[key]) acc[key] = []
		acc[key].push(cur)
		return acc
	}, {})
	const groups = Object.keys(grouped)
		.sort((a, b) => parseInt(a) - parseInt(b))
		.map((key) => grouped[key])
	for (const group of groups)
		await Promise.all(
			group.map(async (h) => {
				try {
					if (typeof h.cb === 'function') return await h.cb()
					return await h.cb
				} catch (error) {
					return onError(error instanceof Error ? error : new Error(`${error}`))
				}
			}),
		)
}
