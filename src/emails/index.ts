import path from 'path'

import pug from 'pug'

export type PhoneText = {
	to: string
	from: string
	content: string
}

export type Email = {
	to: string
	subject: string
	content: string
	from: string
	data: {}
}

export const readEmailFromPug = async (filePath: string, data: Record<string, any>) => {
	// filePath needs to be relative to the root of the running process
	const file = path.join('./', filePath)
	return pug.renderFile(file, data)
}
