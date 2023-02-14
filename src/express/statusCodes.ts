import { Enum } from '../enums/types'

export const StatusCodes = {
	Ok: 200,
	BadRequest: 400,
	NotAuthenticated: 401,
	NotAuthorized: 403,
	NotFound: 404,
	ValidationError: 422,
	TooManyRequests: 429,
	ServerError: 500,
	AccountNotVerified: 460,
	AccessTokenExpired: 461,
	RefreshTokenMisused: 462,
	InvalidToken: 463
} as const

export type SupportedStatusCodes = Enum<typeof StatusCodes>