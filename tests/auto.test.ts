import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const unhandledRoutes: string[] = [];

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture({
    initialHandlers: [
      http.get('/resource', () => {
        return new Response('hello world')
      }),
    ],
    onUnhandledRequest: (request) => {
      // store unhandled routes so we can assert on them
      unhandledRoutes.push(new URL(request.url).pathname);
    },
  }),
})

test('automatically applies the network fixture', async ({ page }) => {
  await page.goto('/')

  const data = await page.evaluate(() => {
    return fetch('/resource').then((response) => {
      return response.text()
    })
  })

  expect(data).toBe('hello world')
})

test("invokes the onUnhandledRequest handler", async ({
  page,
}) => {
  await page.goto('/')

  const data = await page.evaluate(() => {
    return fetch('/unhandled-resource').then((response) => {
      return; // no-op
    })
  })

  expect(unhandledRoutes).toContain("/unhandled-resource");
});