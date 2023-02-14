import { Enum, IAuthRole } from '../enums/types'

export interface RefreshUser {
	id: string
}

export interface AuthUser {
	id: string
	roles: AuthRoles
}

export interface AuthRoles extends Partial<Record<Enum<IAuthRole>, boolean>> {}