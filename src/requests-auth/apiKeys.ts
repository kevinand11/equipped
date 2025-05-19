import type { AuthUser } from '../types/overrides'

export abstract class BaseApiKeysUtility {
	abstract verifyApiKey(apiKey: string): Promise<AuthUser>
}
