import { addWaitBeforeExit } from '../exit'
import { Instance } from '../instance'
import { BaseEntity } from '../structure'
import { mongoose } from './index'

type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }

const collections = [] as {
	collection: mongoose.Model<any>,
	callbacks: ChangeStreamCallbacks<any, any>,
	mapper: (model: any | null) => any | null
}[]

export type ChangeStreamCallbacks<Model, Entity> = {
	created?: (data: { before: null, after: Entity }) => Promise<void>
	updated?: (data: { before: Entity, after: Entity, changes: DeepPartial<Model> }) => Promise<void>
	deleted?: (data: { before: Entity, after: null }) => Promise<void>
}

const startChangeStream = async <Model extends { _id: string }, Entity extends BaseEntity> (
	collection: mongoose.Model<Model | any>,
	callbacks: ChangeStreamCallbacks<Model, Entity>,
	mapper: (model: Model | null) => Entity | null,
	skipResume = false) => {

	const dbName = collection.collection.collectionName as any
	const cloneName = dbName + '_streams_clone'
	const getClone = () => collection.collection.conn.db.collection(cloneName)
	const getStreamTokens = () => collection.collection.conn.db.collection('stream-tokens')

	const res = await getStreamTokens().findOne({ _id: dbName })
	const resumeToken = skipResume ? undefined : res?.resumeToken

	const changeStream = collection
		.watch([], { fullDocument: 'updateLookup', startAfter: resumeToken })
		.on('change', async (data) => {
			// @ts-ignore
			const streamId = data._id._data
			const cacheName = `streams-${streamId}`
			const cached = await Instance.get().cache.setInTransaction(cacheName, streamId, 15)
			if (cached[0]) return
			addWaitBeforeExit((async () => {
				await getStreamTokens().findOneAndUpdate({ _id: dbName }, { $set: { resumeToken: data._id } }, { upsert: true })

				if (data.operationType === 'insert') {
					// @ts-ignore
					const _id = data.documentKey!._id
					const after = data.fullDocument as Model
					const { value } = await getClone().findOneAndUpdate({ _id }, { $set: { ...after, _id } }, {
						upsert: true,
						returnDocument: 'after'
					})
					if (value) callbacks.created?.({
						before: null,
						after: mapper(new collection(after))!
					})
				}

				if (data.operationType === 'delete') {
					// @ts-ignore
					const _id = data.documentKey!._id
					const { value: before } = await getClone().findOneAndDelete({ _id })
					if (before) callbacks.deleted?.({
						before: mapper(new collection(before))!,
						after: null
					})
				}

				if (data.operationType === 'update') {
					// @ts-ignore
					const _id = data.documentKey!._id
					const after = data.fullDocument as Model
					const { value: before } = await getClone().findOneAndUpdate({ _id }, { $set: after }, { returnDocument: 'before' })
					// @ts-ignore
					const {
						updatedFields = {},
						removedFields = [],
						truncatedArrays = []
					} = data.updateDescription ?? {}
					const changed = removedFields
						.map((f) => f.toString())
						.concat(truncatedArrays.map((a) => a.field))
						.concat(Object.keys(updatedFields))
					const changes = getObjectsFromKeys(changed)
					if (before) callbacks.updated?.({
						before: mapper(new collection(before))!,
						after: mapper(new collection(after))!,
						changes
					})
				}
			})())
		})
		.on('error', async (err) => {
			await Instance.get().logger.error(`Change Stream errored out: ${dbName}: ${err.message}`)
			changeStream.close()
			return startChangeStream(collection, callbacks, mapper, true)
		})
	addWaitBeforeExit(() => changeStream.close())

	await Instance.get().logger.info(`${dbName} changestream started`)
}

export const generateChangeStreams = async <Model extends { _id: string }, Entity extends BaseEntity> (
	collection: mongoose.Model<Model | any>,
	callbacks: ChangeStreamCallbacks<Model, Entity>,
	mapper: (model: Model | null) => Entity | null) => {

	collections.push({ collection, callbacks, mapper })
}

export const startAllChangeStreams = async () => {
	await Promise.all(
		collections.map(async ({ collection, callbacks, mapper }) => {
			await startChangeStream(collection, callbacks, mapper)
		})
	)
}

const deepMerge = (objFrom: any, objTo: any) => Object.keys(objFrom)
	.reduce(
		(merged, key) => {
			merged[key] = objFrom[key] instanceof Object && !Array.isArray(objFrom[key])
				? deepMerge(objFrom[key], merged[key] ?? {})
				: objFrom[key]
			return merged
		}, { ...objTo }
	)

const formObject = (key: string) => key.split('.').reverse().reduce((acc, value) => {
	return { [value]: acc ?? true }
}, null as unknown as any)

const getObjectsFromKeys = (keys: string[]) => keys.map(formObject).reduce(deepMerge, {})