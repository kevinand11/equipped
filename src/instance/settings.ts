import type { SASLOptions } from 'kafkajs'
import type { Level } from 'pino'
import type { RedisClientOptions } from 'redis'

import type { ServerTypes } from '../server'

export type Settings = {
	accessTokenKey: string
	accessTokenTTL: number
	refreshTokenKey: string
	refreshTokenTTL: number
	debeziumUrl: string
	mongoDbURI: string
	rabbitURI: string
	kafka: { brokers: string[]; ssl?: boolean; sasl?: Extract<SASLOptions, { mechanism: 'plain' }> }
	redis: Omit<RedisClientOptions, 'modules' | 'functions' | 'scripts'>
	app: string
	appId: string
	bullQueueName: string
	eventColumnName: string
	maxFileUploadSizeInMb: number
	rateLimit: {
		enabled?: boolean
		periodInMs?: number
		limit?: number
	}
	slowdown: {
		enabled?: boolean
		periodInMs?: number
		delayAfter?: number
		delayInMs?: number
	}
	hashSaltRounds: number
	paginationDefaultLimit: number
	server: ServerTypes
	openapi: {
		docsVersion?: string
		docsBaseUrl?: string[]
		docsPath?: string
	}
	logLevel: Level
	logRequests: boolean
	requestSchemaValidation: boolean
}

export const defaulInstanceSetting: Settings = {
	accessTokenKey: 'accessTokenKey',
	accessTokenTTL: 60 * 60,
	refreshTokenKey: 'refreshTokenKey',
	refreshTokenTTL: 14 * 24 * 60 * 60,
	debeziumUrl: '',
	mongoDbURI: '',
	rabbitURI: '',
	redis: {},
	kafka: { brokers: [] },
	app: 'app',
	appId: 'appId',
	bullQueueName: 'appTasksQueue',
	eventColumnName: 'appEventsColumn',
	maxFileUploadSizeInMb: 500,
	rateLimit: {
		enabled: false,
		periodInMs: 60 * 60 * 1000,
		limit: 5000,
	},
	slowdown: {
		enabled: false,
		periodInMs: 10 * 60 * 1000,
		delayAfter: 2000,
		delayInMs: 500,
	},
	hashSaltRounds: 10,
	paginationDefaultLimit: 100,
	server: 'express',
	openapi: {
		docsVersion: '1.0.0',
		docsBaseUrl: ['/'],
		docsPath: '/__docs',
	},
	logLevel: 'info',
	logRequests: true,
	requestSchemaValidation: false,
}
