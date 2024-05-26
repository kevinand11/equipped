export type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }

export type Paths<T, D = never> = T extends object ? { [K in keyof T]: `${Exclude<K, symbol>}${'' | `.${Paths<T[K]>}`}` }[keyof T] : D

export type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never

export type Defined<T> = T extends undefined ? never : T