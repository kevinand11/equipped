import type { SASLOptions } from 'kafkajs'
import type { Level } from 'pino'

import { AuthUser, RefreshUser } from '../requests-auth'
import type { ServerTypes } from '../server'


export type Settings = {
	debeziumUrl: string
	mongoDbURI: string
	rabbitURI: string
	kafka: { brokers: string[]; ssl?: boolean; sasl?: Extract<SASLOptions, { mechanism: 'plain' }>; confluent?: boolean }
	redis: {
		host?: string
		port?: number
		password?: string
		username?: string
		tls?: boolean
		cluster?: boolean
	}
	app: string
	appId: string
	bullQueueName: string
	eventColumnName: string
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
	logLevel: Level
	hashSaltRounds: number
	server: ServerTypes
	openapi: {
		docsVersion?: string
		docsBaseUrl?: string[]
		docsPath?: string
	}
	requests: {
		log?: boolean
		schemaValidation?: boolean
		paginationDefaultLimit: number
		maxFileUploadSizeInMb: number
	}
	requestsAuth: {
		accessToken: {
			key: string
			ttl: number
			verify: (token: string) => Promise<AuthUser>
		},
		refreshToken: {
			key: string
			ttl: number
			verify: (token: string) => Promise<RefreshUser>
		},
		apiKey?: {
			verify: (key: string) => Promise<AuthUser>
		}
	}
}

export const defaulInstanceSetting: Settings = {
	debeziumUrl: '',
	mongoDbURI: '',
	rabbitURI: '',
	redis: {},
	kafka: { brokers: [] },
	app: 'app',
	appId: 'appId',
	bullQueueName: 'appTasksQueue',
	eventColumnName: 'appEventsColumn',
	hashSaltRounds: 10,
	logLevel: 'info',
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
	server: 'express',
	openapi: {
		docsVersion: '1.0.0',
		docsBaseUrl: ['/'],
		docsPath: '/__docs',
	},
	requests: {
		log: true,
		schemaValidation: false,
		paginationDefaultLimit: 100,
		maxFileUploadSizeInMb: 500,
	},
	requestsAuth: {
		accessToken: {
			key: 'accessTokenKey',
			ttl: 60 * 60,
			verify: defaultTokenVerifier,
		},
		refreshToken: {
			key: 'refreshTokenKey',
			ttl: 14 * 24 * 60 * 60,
			verify: defaultTokenVerifier,
		}
	},
}

async function defaultTokenVerifier (_token: string): Promise<never> {
	throw new Error('Not implemented')
}