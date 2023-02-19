import mongoose from 'mongoose'

export * from './query'

export const start = async (url: string) => {
	await mongoose.connect(url)
}

export const close = async () => {
	await mongoose.disconnect()
}

export { mongoose }