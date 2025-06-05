# `@msw/playwright`

[Mock Service Worker](https://mswjs.io) binding for [Playwright](https://playwright.dev/).

## Usage

```sh
npm i @msw/playwright
```

```ts
// playwright.setup.ts
import { test as testBase } from '@playwright/test'
import { createWorkerFixture } from '@msw/playwright'
import { handlers } from '../mocks/handlers.js'

export const test = testBase.extend({
  worker: createWorkerFixture({
    initialHandlers: handlers,
  }),
})
```

```ts
import { http, HttpResponse } from 'msw'
import { test } from './playwright.setup.js'

test('displays the user dashboard', async ({ worker, page }) => {
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
