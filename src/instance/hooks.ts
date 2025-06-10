export type HookEvent = 'pre:start' | 'post:start' | 'pre:close' | 'post:close' | 'pre:exit'
export type HookCb = Promise<unknown | void> | (() => void | unknown | Promise<void | unknown>)
export type HookRecord = { cb: HookCb; priority: boolean }

async function runCb(cb: HookCb) {
	if (typeof cb === 'function') return await cb()
	return await cb
}

export async function runHooks(hooks: HookRecord[]) {
	const serial = hooks.filter((h) => h.priority)
	const parallel = hooks.filter((h) => !h.priority)
	for (const hook of serial) await runCb(hook.cb)
	await Promise.all(parallel.map((h) => runCb(h.cb)))
}
