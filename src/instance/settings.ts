import type { KafkaConfig } from 'kafkajs'
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
	kafka: KafkaConfig
	redis: Omit<RedisClientOptions, 'modules' | 'functions' | 'scripts'>
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
	openapiDocsVersion: string
	openapiDocsBaseUrl: string[]
	openapiDocsPath: string
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
	appId: 'appId',
	bullQueueName: 'appTasksQueue',
	eventColumnName: 'appEventsColumn',
	maxFileUploadSizeInMb: 500,
	useRateLimit: false,
	rateLimitPeriodInMs: 60 * 60 * 1000,
	rateLimit: 5000,
	useSlowDown: false,
	slowDownPeriodInMs: 10 * 60 * 1000,
	slowDownAfter: 2000,
	slowDownDelayInMs: 500,
	hashSaltRounds: 10,
	paginationDefaultLimit: 100,
	server: 'express',
	openapiDocsVersion: '1.0.0',
	openapiDocsBaseUrl: ['/'],
	openapiDocsPath: '/__docs',
	logLevel: 'info',
	logRequests: true,
	requestSchemaValidation: false,
}
