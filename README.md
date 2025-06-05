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
  worker.use(...)
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
import { createWorkerFixture, type WorkerFixture } from '@msw/playwright'
import { handlers } from '../mocks/handlers.js'

interface Fixtures {
  worker: WorkerFixture
}

export const test = testBase.extend<Fixtures>({
  // Create your worker fixture to access in tests.
  worker: createWorkerFixture({
    initialHandlers: handlers,
  }),
})
```

```ts
import { http, HttpResponse } from 'msw'
import { test } from './playwright.setup.js'

test('displays the user dashboard', async ({ worker, page }) => {
  // Access and use the worker as you normally would!
  // No more disrupted context between processes.
  worker.use(
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
