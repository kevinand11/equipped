import { ulid } from 'ulid'
import { v } from 'valleyed'

import { Schema } from '../schema'

export const EventLogSchema = Schema.from('event_log')
	.pk('key', v.string(), () => ulid())
	.field('name', v.string())
	.field('ts', v.number())
	.field('body', v.any())
	.field('by', v.nullable(v.string()))
	.build()
