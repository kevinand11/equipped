export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const retry = async <T> (cb: () => Promise<T>, trials: number, waitTimeInMs: number) => {
	trials -= 1
	return await cb()
		.catch(async (err) => {
			if (trials <= 0) throw err
			await sleep(waitTimeInMs)
			return await retry(cb, trials, waitTimeInMs)
		})
}