export type Settings = {
	isDev: boolean
	accessTokenKey: string
	accessTokenTTL: number
	refreshTokenKey: string
	refreshTokenTTL: number
	mongoDbURI: string
	rabbitURI: string
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
}

export const defaulInstanceSetting: Settings = {
	isDev: false,
	accessTokenKey: 'accessTokenKey',
	accessTokenTTL: 60 * 60,
	refreshTokenKey: 'refreshTokenKey',
	refreshTokenTTL: 14 * 24 * 60 * 60,
	mongoDbURI: '',
	rabbitURI: '',
	redisURI: '',
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
	paginationDefaultLimit: 100
}