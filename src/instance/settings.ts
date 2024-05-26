import { Level } from 'pino'
import type { ServerTypes } from '../server'

export type Settings = {
	isDev: boolean
	accessTokenKey: string
	accessTokenTTL: number
	refreshTokenKey: string
	refreshTokenTTL: number
	debeziumUrl: string
	mongoDbURI: string
	rabbitURI: string
	kafkaURIs: string[]
	redisURI: string
	appId: string
	bullQueueName: string
	eventColumnName: string
	maxFileUploadSizeInMb: number
	useRateLimit: boolean
	rateLimitPeriodInMs: number
	rateLimit: number
	useSlowDown: boolean
	slowDownPeriodInMs: number
	slowDownAfter: number
	slowDownDelayInMs: number
	hashSaltRounds: number
	paginationDefaultLimit: number
	server: ServerTypes
	swaggerDocsVersion: string
	swaggerDocsUrl: string
	logLevel: Level
	logRequests: boolean
}

export const defaulInstanceSetting: Settings = {
	isDev: false,
	accessTokenKey: 'accessTokenKey',
	accessTokenTTL: 60 * 60,
	refreshTokenKey: 'refreshTokenKey',
	refreshTokenTTL: 14 * 24 * 60 * 60,
	debeziumUrl: '',
	mongoDbURI: '',
	rabbitURI: '',
	redisURI: '',
	kafkaURIs: [],
	appId: 'appId',
	bullQueueName: 'appTasksQueue',
	eventColumnName: 'appEventsColumn',
	maxFileUploadSizeInMb: 500,
	useRateLimit: false,
	rateLimitPeriodInMs: 60 * 60 * 1000,
	rateLimit: 2500,
	useSlowDown: false,
	slowDownPeriodInMs: 10 * 60 * 1000,
	slowDownAfter: 1000,
	slowDownDelayInMs: 500,
	hashSaltRounds: 10,
	paginationDefaultLimit: 100,
	server: 'express',
	swaggerDocsVersion: '1.0.0',
	swaggerDocsUrl: '/__docs',
	logLevel: 'info',
	logRequests: true,
}