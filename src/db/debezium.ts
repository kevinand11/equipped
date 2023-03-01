export type DebeziumSetup = Partial<{
	'connector.class': string
	'topic.prefix': string
	'key.converter': string
	'key.converter.schemas.enable': string
	'value.converter': string
	'value.converter.schemas.enable': string
}> & Record<string, string>

export const TopicPrefix = 'equipped'

export const DefaultDebeziumSetup: DebeziumSetup = {
	'topic.prefix': TopicPrefix,
	'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
	'key.converter.schemas.enable': 'false',
	'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
	'value.converter.schemas.enable': 'false'
}