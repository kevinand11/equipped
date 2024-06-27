import { Enum, IAuthRole } from '../enums/types'

export interface RefreshUser {
	id: string
}

export interface AuthUser {
	id: string
	roles: AuthRoles
}

export type AuthRoles = { [Role in Enum<IAuthRole>]?: boolean }