import mongoose from 'mongoose'

export const start = async (url: string) => {
	await mongoose.connect(url)
}

export const close = async () => {
	await mongoose.disconnect()
}