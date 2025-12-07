import { match as Match } from 'path-to-regexp'
import type { Server } from 'socket.io'

import type { Entity } from '../dbs/base/core'
import { Instance } from '../instance'
import type { AuthUser } from '../types'
import type { ServerConfig } from './pipes'
import { StatusCodes, type StatusCodesEnum } from './types'

enum EmitTypes {
	created = 'created',
	updated = 'updated',
	deleted = 'deleted',
}

const EmitterEvent = '__listener_emitter'
type EmitData = { channel: string; type: EmitTypes; after: any; before: any }
type LeaveRoomParams = { channel: string }
type JoinRoomParams = { channel: string; token?: string; query: Record<string, any> }
type Callback = (params: { code: StatusCodesEnum; message: string; channel: string }) => void
export type OnJoinFn = (
	data: { channel: string; user: AuthUser | null },
	params: Record<string, any>,
	query: Record<string, any>,
) => Promise<string | null>
export type SocketCallbacks = {
	onConnect: (userId: string, socketId: string) => Promise<void>
	onDisconnect: (userId: string, socketId: string) => Promise<void>
}

const defaultTo = '*'

export class SocketEmitter {
	readonly socketInstance: Server
	#connectionCallbacks: SocketCallbacks = { onConnect: async () => {}, onDisconnect: async () => {} }
	#routes = {} as Record<string, OnJoinFn>
	#publish: (data: EmitData) => Promise<void> = async () => {}

	constructor(
		socket: Server,
		private config: ServerConfig,
	) {
		this.socketInstance = socket
		this.#setupSocketConnection()
		Instance.on(
			'setup',
			() => {
				const stream = config.eventBus?.createStream(EmitterEvent as never, { fanout: true })
				this.#publish = stream
					? (stream.publish as unknown as (data: EmitData) => Promise<void>)
					: async (data: EmitData) => {
							socket.to(data.channel).emit(data.channel, data)
						}
				stream?.subscribe(async (data: EmitData) => {
					socket.to(data.channel).emit(data.channel, data)
				})
			},
			1,
		)
	}

	async created<T extends Entity>(channels: string[], data: T, to: string | string[] | null) {
		await this.#emit(channels, EmitTypes.created, { after: data.toJSON(), before: null }, to)
	}

	async updated<T extends Entity>(channels: string[], { after, before }: { after: T; before: T }, to: string | string[] | null) {
		await this.#emit(channels, EmitTypes.updated, { after: after.toJSON(), before: before.toJSON() }, to)
	}

	async deleted<T extends Entity>(channels: string[], data: T, to: string | string[] | null) {
		await this.#emit(channels, EmitTypes.deleted, { before: data.toJSON(), after: null }, to)
	}

	async #emit(channels: string[], type: EmitTypes, { before, after }: { after: any; before: any }, to: string | string[] | null) {
		const toArray = Array.isArray(to) ? to : [to ?? defaultTo]
		const channelMap = channels.flatMap((c) => toArray.map((to) => `${to}:${c}`))
		await Promise.all(channelMap.map(async (channel) => this.#publish({ channel, type, before, after })))
	}

	set connectionCallbacks(callbacks: SocketCallbacks) {
		this.#connectionCallbacks = callbacks
		this.#setupSocketConnection()
	}

	register(channel: string, onJoin: OnJoinFn) {
		this.#routes[channel] = onJoin
		this.#routes[channel + '/:id'] = onJoin
		return this
	}

	#getConfig(channel: string) {
		const matcher = (key: string) => Match(key)(channel)
		const matchedChannel = Object.keys(this.#routes).find(matcher) ?? null
		if (!matchedChannel) return null
		const match = matcher(matchedChannel)
		if (!match) return null
		return {
			config: this.#routes[matchedChannel],
			params: match.params,
		}
	}

	#setupSocketConnection = () => {
		this.socketInstance.removeAllListeners('connection')
		this.socketInstance.on('connection', async (socket) => {
			const socketId = socket.id
			let user = null as AuthUser | null
			const tokensUtil = this.config.requestsAuth.tokens
			if (socket.handshake.auth.authorization && tokensUtil)
				user = await tokensUtil.verifyAccessToken(socket.handshake.auth.authorization ?? '').catch(() => null)
			socket.on('leave', async (data: LeaveRoomParams, callback: Callback) => {
				if (!data.channel)
					return (
						typeof callback === 'function' &&
						callback({
							code: StatusCodes.ValidationError,
							message: 'channel is required',
							channel: '',
						})
					)
				socket.leave(data.channel)
				return (
					typeof callback === 'function' &&
					callback({
						code: StatusCodes.Ok,
						message: '',
						channel: data.channel,
					})
				)
			})
			socket.on('join', async (data: JoinRoomParams, callback: Callback) => {
				if (!data.channel)
					return (
						typeof callback === 'function' &&
						callback({
							code: StatusCodes.ValidationError,
							message: 'channel is required',
							channel: '',
						})
					)
				const channel = data.channel
				const route = this.#getConfig(channel) ?? null
				if (!route)
					return (
						typeof callback === 'function' &&
						callback({
							code: StatusCodes.BadRequest,
							message: 'unknown channel',
							channel,
						})
					)
				const to = await route.config({ channel, user }, route.params, data.query ?? {})
				const newChannel = `${to ?? defaultTo}:${channel}`
				socket.join(newChannel)
				return (
					typeof callback === 'function' &&
					callback({
						code: StatusCodes.Ok,
						message: '',
						channel: newChannel,
					})
				)
			})
			if (user) await this.#connectionCallbacks.onConnect(user.id, socketId)
			socket.on('disconnect', async () => {
				if (user) await this.#connectionCallbacks.onDisconnect(user.id, socketId)
			})
		})
	}
}
