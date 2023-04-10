# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [4.1.12](https://github.com/kevinand11/equipped/compare/v4.1.11...v4.1.12) (2023-04-10)

### [4.1.11](https://github.com/kevinand11/equipped/compare/v4.1.10...v4.1.11) (2023-04-09)


### Bug Fixes

* do not convert value in JSON.parse if it is not a string ([e7d735f](https://github.com/kevinand11/equipped/commit/e7d735f0bc3f82210102d5a9d667e2574eab3cea))

### [4.1.10](https://github.com/kevinand11/equipped/compare/v4.1.9...v4.1.10) (2023-04-07)


### Features

* add list to ignore when converting baseEntity to json ([624d134](https://github.com/kevinand11/equipped/commit/624d134f87b3acbec686cde1ad0c02d6b34dc73b))

### [4.1.9](https://github.com/kevinand11/equipped/compare/v4.1.8...v4.1.9) (2023-04-04)


### Bug Fixes

* export bull jobs interfaces to allow extending in user code ([a897617](https://github.com/kevinand11/equipped/commit/a897617eb7ee5bc6153568c7c4cbbc45d36e0f76))

### [4.1.8](https://github.com/kevinand11/equipped/compare/v4.0.2-alpha.4...v4.1.8) (2023-03-30)


### Bug Fixes

* update to latest version of valleyed ([7999007](https://github.com/kevinand11/equipped/commit/799900703519fdf8f56a57abd609d2575f14a173))

### [4.1.7](https://github.com/kevinand11/equipped/compare/v4.1.6...v4.1.7) (2023-03-22)


### Bug Fixes

* parse _id if string or ObjectId ([3aab101](https://github.com/kevinand11/equipped/commit/3aab101960a3a1fe88bea887a1b8e638ae2f3577))

### [4.1.6](https://github.com/kevinand11/equipped/compare/v4.1.5...v4.1.6) (2023-03-18)


### Features

* update to latest version of valleyed ([bdcd8e1](https://github.com/kevinand11/equipped/commit/bdcd8e16c3a05dadf7393558cae746c3ab007ddf))

### [4.1.5](https://github.com/kevinand11/equipped/compare/v4.1.4...v4.1.5) (2023-03-17)


### Features

* update to latest version of valleyed that fixes default problems ([77e4225](https://github.com/kevinand11/equipped/commit/77e4225e10600b7ab27a82970132d9ff7ca9062a))

### [4.1.4](https://github.com/kevinand11/equipped/compare/v4.1.3...v4.1.4) (2023-03-14)


### Features

* update to latest version of valleyed ([60c8c95](https://github.com/kevinand11/equipped/commit/60c8c95d0e0164d6f7934a6396da05b0543d7fbe))

### [4.1.3](https://github.com/kevinand11/equipped/compare/v4.1.2...v4.1.3) (2023-03-11)

### [4.1.2](https://github.com/kevinand11/equipped/compare/v4.1.1...v4.1.2) (2023-03-11)

### [4.1.1](https://github.com/kevinand11/equipped/compare/v4.1.0...v4.1.1) (2023-03-10)

## [4.1.0](https://github.com/kevinand11/equipped/compare/v4.0.2-alpha.3...v4.1.0) (2023-03-07)


### Features

* access db name from mongoose ([febdee0](https://github.com/kevinand11/equipped/commit/febdee0264fe0f7d2de02fcd08a380a8c93df68c))
* add fanout option for event subscribers ([4f0c060](https://github.com/kevinand11/equipped/commit/4f0c060aa2d99fd6128499d49e1f163d1e93a721))
* add helmet and supertest ([71ddcad](https://github.com/kevinand11/equipped/commit/71ddcad4e2b191913a890e7480619f1df527fde1))
* add Id to mongo db ([55a8728](https://github.com/kevinand11/equipped/commit/55a872827a427a65a9be25ce464468935a4c5674))
* add kafka eventbus ([22f79d4](https://github.com/kevinand11/equipped/commit/22f79d48e48cc7c5695a43089f6a724f479ed81c))
* automatically start subscribers in Instance.startConnections ([96a07c9](https://github.com/kevinand11/equipped/commit/96a07c923a90b9203920ab490c4554098dfab5e8))
* enable defaults, getters and virtuals on lean docs ([69f9d2b](https://github.com/kevinand11/equipped/commit/69f9d2b5f26072e91d411cc1dd5e676264a6a586))
* enable lean documents for query ([ce04a8a](https://github.com/kevinand11/equipped/commit/ce04a8a326025916a32ce017634328c37c09a7e0))
* enable pre images for all collections ([710457d](https://github.com/kevinand11/equipped/commit/710457d1132cd380a0890b191f98fece4473729f))
* hydrate cs docs with getters and virtuals ([c93809a](https://github.com/kevinand11/equipped/commit/c93809ab8f2f4597fb310c68dc8d95b9f901aedd))
* new changestream api ([923660b](https://github.com/kevinand11/equipped/commit/923660b11c1ab6f799c030b37dc6ce06c3b90ebb))
* server request ip ([371dac1](https://github.com/kevinand11/equipped/commit/371dac18ef729c88da0e8885e1e63e581e8b979b))
* socket emitters fanout ([65a36db](https://github.com/kevinand11/equipped/commit/65a36db9671205a30fe8aabd3b1763714e94f886))


### Bug Fixes

* hydrate _id from changes ([65e6539](https://github.com/kevinand11/equipped/commit/65e6539bfc9644421152af3ad5c0436a2b4ed3dc))
* loop over db connections ([eb3f548](https://github.com/kevinand11/equipped/commit/eb3f548f2e7a2f172cb4ead8ff655df0fc8f3b95))
* remove cache setInTransaction ([4f1b3c0](https://github.com/kevinand11/equipped/commit/4f1b3c0db37621162065c69fc24eab744675da27))
* setup debezium connection to mongo ([3d36283](https://github.com/kevinand11/equipped/commit/3d3628349910d8ba0633578b6578f09e682b8145))

### [4.1.7](https://github.com/kevinand11/equipped/compare/v4.1.6...v4.1.7) (2023-03-22)


### Bug Fixes

* parse _id if string or ObjectId ([3aab101](https://github.com/kevinand11/equipped/commit/3aab101960a3a1fe88bea887a1b8e638ae2f3577))

### [4.1.6](https://github.com/kevinand11/equipped/compare/v4.1.5...v4.1.6) (2023-03-18)


### Features

* update to latest version of valleyed ([bdcd8e1](https://github.com/kevinand11/equipped/commit/bdcd8e16c3a05dadf7393558cae746c3ab007ddf))

### [4.1.5](https://github.com/kevinand11/equipped/compare/v4.1.4...v4.1.5) (2023-03-17)


### Features

* update to latest version of valleyed that fixes default problems ([77e4225](https://github.com/kevinand11/equipped/commit/77e4225e10600b7ab27a82970132d9ff7ca9062a))

### [4.1.4](https://github.com/kevinand11/equipped/compare/v4.1.3...v4.1.4) (2023-03-14)


### Features

* update to latest version of valleyed ([60c8c95](https://github.com/kevinand11/equipped/commit/60c8c95d0e0164d6f7934a6396da05b0543d7fbe))

### [4.1.3](https://github.com/kevinand11/equipped/compare/v4.1.2...v4.1.3) (2023-03-11)

### [4.1.2](https://github.com/kevinand11/equipped/compare/v4.1.1...v4.1.2) (2023-03-11)

### [4.1.1](https://github.com/kevinand11/equipped/compare/v4.1.0...v4.1.1) (2023-03-10)

## [4.1.0](https://github.com/kevinand11/equipped/compare/v4.0.2-alpha.3...v4.1.0) (2023-03-07)


### Features

* access db name from mongoose ([febdee0](https://github.com/kevinand11/equipped/commit/febdee0264fe0f7d2de02fcd08a380a8c93df68c))
* add fanout option for event subscribers ([4f0c060](https://github.com/kevinand11/equipped/commit/4f0c060aa2d99fd6128499d49e1f163d1e93a721))
* add helmet and supertest ([71ddcad](https://github.com/kevinand11/equipped/commit/71ddcad4e2b191913a890e7480619f1df527fde1))
* add Id to mongo db ([55a8728](https://github.com/kevinand11/equipped/commit/55a872827a427a65a9be25ce464468935a4c5674))
* add kafka eventbus ([22f79d4](https://github.com/kevinand11/equipped/commit/22f79d48e48cc7c5695a43089f6a724f479ed81c))
* automatically start subscribers in Instance.startConnections ([96a07c9](https://github.com/kevinand11/equipped/commit/96a07c923a90b9203920ab490c4554098dfab5e8))
* enable defaults, getters and virtuals on lean docs ([69f9d2b](https://github.com/kevinand11/equipped/commit/69f9d2b5f26072e91d411cc1dd5e676264a6a586))
* enable lean documents for query ([ce04a8a](https://github.com/kevinand11/equipped/commit/ce04a8a326025916a32ce017634328c37c09a7e0))
* enable pre images for all collections ([710457d](https://github.com/kevinand11/equipped/commit/710457d1132cd380a0890b191f98fece4473729f))
* hydrate cs docs with getters and virtuals ([c93809a](https://github.com/kevinand11/equipped/commit/c93809ab8f2f4597fb310c68dc8d95b9f901aedd))
* new changestream api ([923660b](https://github.com/kevinand11/equipped/commit/923660b11c1ab6f799c030b37dc6ce06c3b90ebb))
* server request ip ([371dac1](https://github.com/kevinand11/equipped/commit/371dac18ef729c88da0e8885e1e63e581e8b979b))
* socket emitters fanout ([65a36db](https://github.com/kevinand11/equipped/commit/65a36db9671205a30fe8aabd3b1763714e94f886))


### Bug Fixes

* hydrate _id from changes ([65e6539](https://github.com/kevinand11/equipped/commit/65e6539bfc9644421152af3ad5c0436a2b4ed3dc))
* loop over db connections ([eb3f548](https://github.com/kevinand11/equipped/commit/eb3f548f2e7a2f172cb4ead8ff655df0fc8f3b95))
* remove cache setInTransaction ([4f1b3c0](https://github.com/kevinand11/equipped/commit/4f1b3c0db37621162065c69fc24eab744675da27))
* setup debezium connection to mongo ([3d36283](https://github.com/kevinand11/equipped/commit/3d3628349910d8ba0633578b6578f09e682b8145))

### [4.0.2-alpha.3](https://github.com/kevinand11/equipped/compare/v4.0.2-alpha.2...v4.0.2-alpha.3) (2023-02-19)

### [4.0.2-alpha.2](https://github.com/kevinand11/equipped/compare/v4.0.2-alpha.1...v4.0.2-alpha.2) (2023-02-19)

### [4.0.2-alpha.1](https://github.com/kevinand11/equipped/compare/v4.0.2...v4.0.2-alpha.1) (2023-02-19)


### Features

* make db change abstract ([e747c3f](https://github.com/kevinand11/equipped/commit/e747c3f2f74dc178521c3ee4d9a79efc8b160d32))

### [4.0.2](https://github.com/kevinand11/equipped/compare/v4.0.1...v4.0.2) (2023-02-16)

### [4.0.1](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha-10...v4.0.1) (2023-02-16)

## [4.0.0-alpha-10](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.9...v4.0.0-alpha-10) (2023-02-16)

## [4.0.0-alpha.9](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.8...v4.0.0-alpha.9) (2023-02-15)


### Bug Fixes

* remove file type from validation ([5511b44](https://github.com/kevinand11/equipped/commit/5511b447a2d80af6cd65af7d222ea1b9126d3bc5))

## [4.0.0-alpha.8](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.7...v4.0.0-alpha.8) (2023-02-14)


### Features

* add isNotTruncated to file types ([4d013e1](https://github.com/kevinand11/equipped/commit/4d013e142301df7e98bbe96a8bf18d5fc3a10dc6))

## [4.0.0-alpha.7](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.6...v4.0.0-alpha.7) (2023-02-14)


### Bug Fixes

* update valleyed version ([638ea0a](https://github.com/kevinand11/equipped/commit/638ea0a2c91967ae897f83b8ea9da480dcd1a7bf))

## [4.0.0-alpha.6](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.5...v4.0.0-alpha.6) (2023-02-14)

## [4.0.0-alpha.5](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.4...v4.0.0-alpha.5) (2023-02-14)


### Bug Fixes

* controllers undefined ([f5b77aa](https://github.com/kevinand11/equipped/commit/f5b77aa7ca0d93eed57b474c2e9dd729b3faa7aa))

## [4.0.0-alpha.4](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.3...v4.0.0-alpha.4) (2023-02-14)

## [4.0.0-alpha.3](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.2...v4.0.0-alpha.3) (2023-02-14)


### Bug Fixes

* rules types ([2d332c8](https://github.com/kevinand11/equipped/commit/2d332c8ce33caf9962c80ba1984f9c04be8148cf))

## [4.0.0-alpha.2](https://github.com/kevinand11/equipped/compare/v4.0.0-alpha.1...v4.0.0-alpha.2) (2023-02-14)


### Bug Fixes

* add test command ([4782e3e](https://github.com/kevinand11/equipped/commit/4782e3ec5be379885724404a3146a7f060086431))

## 4.0.0-alpha.1 (2023-02-14)


### Features

* init repo ([6d1d857](https://github.com/kevinand11/equipped/commit/6d1d857947267830f7b2228864ca3032b7bc0a72))


### Bug Fixes

* change build command ([434b079](https://github.com/kevinand11/equipped/commit/434b0791d81077e2498d23455b10e89ee2f7d299))
* validation ([07c66b6](https://github.com/kevinand11/equipped/commit/07c66b63c39c337f18d152832bc886774e2071b6))
