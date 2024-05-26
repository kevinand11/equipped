export type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }

export type Paths<T> = T extends object ? { [K in keyof T]: `${Exclude<K, symbol>}${'' | `.${Paths<T[K]>}`}` }[keyof T] : never

export type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never