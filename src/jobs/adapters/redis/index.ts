import { Queue, Worker } from 'bullmq'
import { v } from 'valleyed'

import { RedisCache, redisConfigPipe } from '../../../cache/adapters/redis'
import { Instance } from '../../../instance'
import { Random, configurable } from '../../../utilities'
import { JobNames, type Cron, type DelayedJobEvent, type Job, type JobCallbacks, type RepeatableJobEvent } from '../base'

export const redisJobsConfigPipe = () =>
	v.meta(
		v.object({
			redisConfig: redisConfigPipe(),
			queueName: v.string(),
		}),
		{ title: 'Redis Jobs Config', $refId: 'RedisJobsConfig' },
	)

export const RedisJob = configurable(redisJobsConfigPipe, (config): Job => {
	const redisCache = RedisCache.create(config.redisConfig, {
		maxRetriesPerRequest: null,
		enableReadyCheck: false,
	})
	const queueName = Instance.get().getScopedName(config.queueName)
	const queue = new Queue(queueName, { connection: redisCache.options.connectionOptions, skipVersionCheck: true })
	const worker = new Worker(
		queueName,
		async (job) => {
			switch (job.name) {
				case JobNames.DelayedJob:
					return (callbacks.onDelayed as any)?.(job.data)
				case JobNames.CronJob:
					return (callbacks.onCron as any)?.(job.data.type)
				case JobNames.RepeatableJob:
					return (callbacks.onRepeatable as any)?.(job.data)
			}
		},
		{ connection: redisCache.options.connectionOptions, autorun: false, skipVersionCheck: true },
	)

	Instance.on(
		'start',
		async () => {
			await cleanup()
			await Promise.all(crons.map(({ cron, name }) => addCron(name, cron)))
			worker.run()
		},
		10,
	)

	const getNewId = () => [Date.now(), Random.string()].join('_')

	const addCron = async (type: Cron | string, cron: string) => {
		const job = await queue.add(
			JobNames.CronJob,
			{ type },
			{
				jobId: getNewId(),
				repeat: { pattern: cron },
				removeOnComplete: true,
				backoff: 1000,
				attempts: 3,
			},
		)
		return job.id!.toString()
	}

	const cleanup = async () => {
		await job.retryAllFailedJobs()
		const repeatableJobs = await queue.getJobSchedulers()
		await Promise.all(repeatableJobs.map((job) => queue.removeJobScheduler(job.key)))
	}

	let callbacks: JobCallbacks = {}
	let crons: { name: Cron; cron: string }[] = []

	const job: Job = {
		get callbacks() {
			return callbacks
		},
		set callbacks(newCallbacks: JobCallbacks) {
			callbacks = newCallbacks
		},
		get crons() {
			return crons
		},
		set crons(newCrons: { name: Cron; cron: string }[]) {
			crons = newCrons
		},
		async addDelayed(data: DelayedJobEvent, delayInMs: number): Promise<string> {
			const job = await queue.add(JobNames.DelayedJob, data, {
				jobId: getNewId(),
				delay: delayInMs,
				removeOnComplete: true,
				backoff: 1000,
				attempts: 3,
			})
			return job.id!.toString()
		},
		async addRepeatable(data: RepeatableJobEvent, cron: string, tz?: string): Promise<string> {
			const job = await queue.add(JobNames.RepeatableJob, data, {
				jobId: getNewId(),
				repeat: { pattern: cron, ...(tz ? { tz } : {}) },
				removeOnComplete: true,
				backoff: 1000,
				attempts: 3,
			})
			return job.opts?.repeat?.key ?? ''
		},
		async removeDelayed(jobId: string) {
			const job = await queue.getJob(jobId)
			if (job) await job.remove()
		},
		async retryAllFailedJobs() {
			const failedJobs = await queue.getFailed()
			await Promise.all(failedJobs.map((job) => job.retry()))
		},
	}

	return job
})
