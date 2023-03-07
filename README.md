# Equipped

<br>

## Installation

This is a [Node.js](https://nodejs.org/en/) module available through the [npm registry](https://www.npmjs.com/package/equipped).
Before installing, [download and install Node.js](https://nodejs.org/en/download/). Node.js 4.2.4 or higher is required.
If this is a brand new project, make sure to create a `package.json` first with the [`npm init` command](https://docs.npmjs.com/creating-a-package-json-file).
Installation is done using the [`npm install` command](https://docs.npmjs.com/getting-started/installing-npm-packages-locally):

### Using npm:
    npm install equipped

### Using yarn:
    yarn add equipped

### Using CDN:

[Equipped jsDelivr CDN](https://www.jsdelivr.com/package/npm/equipped)

<br>

## Basic Usage
Before use, the package must be initialized in the entry point into your application, with the required settings.
```ts
import { Instance } from 'equipped'

Instance.initialize({
    isDev: true, // Are you running in a dev environment
    appId: 'testing', // An id to identify your application
    mongoDbURI: 'mongodb://...', // A mongodb url if you want to use a database
    redisURI: 'redis://localhost:6379', // A redis url if you want to use a redis cache. Confirm all other functionality you intend to use do not depend on the cache, even if you are not using a cache directly
    ...other settings
})
```

<br>

After the app has been initialized, the Instance class returns a singleton that provides access to most functionality provided by Equipped
```ts
import { Instance } from 'equipped'

const appInstance = Instance.get()
```

<br>

To start a server
```ts
import { makeController, StatusCodes } from 'equipped'

// Aggregate all your routes into an array. This can be defined in the file or imported from your controllers etc
appInstance.server.routes = [
    {
        path: '/',
        method: 'get',
        controllers: [makeController(async () => {
            return {
                result: 'Hello world',
                status: StatusCodes.Ok
            }
        })]
    }
]

await appInstance.server.start(8080)
```