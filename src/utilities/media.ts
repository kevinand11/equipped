import { parseBuffer } from 'music-metadata'

export const getMediaDuration = async (buffer: Buffer) => {
	try {
		const meta = await parseBuffer(buffer)
		return meta.format.duration ?? 0
	} catch {
		return 0
	}
}
