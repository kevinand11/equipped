import type { AuthUser } from './types'


export abstract class BaseApiKeysUtility {
	abstract verifyApiKey(apiKey: string) :Promise<AuthUser>
}
