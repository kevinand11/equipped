import mongoose from 'mongoose'
import { BaseEntity } from '../structure'
import { MongoDbChange } from './mongoose/change'
import { DbChange } from './_change'

const dbChanges = [] as DbChange<any, any>[]

export const generateMongoDbChange = async <Model extends { _id: string }, Entity extends BaseEntity> (
	collection: mongoose.Model<Model | any>,
	mapper: (model: Model | null) => Entity | null) => {
	const change = new MongoDbChange<Model, Entity>(collection, mapper)
	dbChanges.push(change)
	return change
}

export const startAllDbChanges = async () => {
	await Promise.all(
		dbChanges.map((change) => change.start())
	)
}