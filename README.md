# `@msw/playwright`

[Mock Service Worker](https://mswjs.io) binding for [Playwright](https://playwright.dev/).

## Motivation

While you can use MSW in Playwright following the default [Browser integration](https://mswjs.io/docs/integrations/browser), the cross-process messaging in Playwright makes it clunky to work with the `worker` instance in one process (your tests; Node.js) to affect another (your app; browser).

```ts
await page.evaluate(() => {
  // In order to reference the worker instance in your tests,
  // you have to set it on `window` alongside any other
  // functions from the `msw` package you want to use since
  // you cannot reference them in `page.evaluate` directly.
  const { worker, http, graphql } = window.msw
  worker.use(...overrides)
})
```

This package aims to provide a better developer experience when mocking APIs in Playwright.

> Until we ship [cross-process request interception](https://github.com/mswjs/msw/pull/1617), `@msw/playwright` will rely on the `page.route()` API to provision the request interception in your tests. That means you _don't have to initialize the worker script_ to use this package. That also means that any `page.route()` limitations now affect this library. Treat this as an implementation detail that is likely to change in the future.

## Usage

```sh
npm i msw @msw/playwright
```

```ts
// playwright.setup.ts
import { test as testBase } from '@playwright/test'
import { createNetworkFixture, type NetworkFixture } from '@msw/playwright'
import { handlers } from '../mocks/handlers.js'

interface Fixtures {
  network: NetworkFixture
}

export const test = testBase.extend<Fixtures>({
  // Create a fixture that will control the network in your tests.
  network: createNetworkFixture({
    initialHandlers: handlers,
  }),
})
```

```ts
import { http, HttpResponse } from 'msw'
import { test } from './playwright.setup.js'

test('displays the user dashboard', async ({ network, page }) => {
  // Access the network fixture and use it as the `setupWorker()` API.
  // No more disrupted context between processes.
  network.use(
    http.get('/user', () => {
      return HttpResponse.json({
        id: 'abc-123',
        firstName: 'John',
        lastName: 'Maverick',
      })
    }),
  )

  await page.goto('/dashboard')
})
```

## Limitations

- Since `context.routeWebSocket()` provides no means of knowing which page triggered a WebSocket connection, relative WebSocket URLs in `ws.link(url)` will be resolved against the _latest_ created page in the browser context.

## Comparison

### `playwright-msw`

[`playwright-msw`](https://github.com/valendres/playwright-msw) is a community package that, just like `@msw/playwright`, aims to provide a better experience when mocking APIs in your Playwright tests.

> While `playwright-msw` is a fantastic tool and a huge inspiration for this package to exist, I believe it approaches the idea at a rather complex angle. That introduces a layer of abstraction that is subjected to the "left behind" problem as it needs to map to any MSW changes explicitly.

|                | `playwright-msw`                                                                      | `@msw/playwright`                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Initialization | `createWorkerFixture()` is used as a _part_ of your custom fixture.                   | `createNetworkFixture()` creates _the entire_ fixture for you, pre-configured.                     |
| Implementation | Uses a custom router to match handlers and a custom wrapper around `SetupWorker` API. | Uses MSW directly. Uses `page.route()` as the source of the network to route through the handlers. |
| Feature set    | Supports `http` and `graphql` namespaces.                                             | Supports all namespaces (`http`, `graphql`, `ws`, any other APIs exposed by MSW in the future).    |
