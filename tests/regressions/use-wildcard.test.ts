/**
 * @see https://github.com/mswjs/playwright/issues/26
 */
import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture({
    initialHandlers: [
      // A permissive wildcard handler.
      http.get('*/objects/:tableName', () => {
        return HttpResponse.text('initial')
      }),
    ],
  }),
})

test('uses a narrower handler to respond to a matching request', async ({
  network,
  page,
}) => {
  network.use(
    // A narrow handler matching the wildcard.
    http.get('/v1/objects/actual', () => {
      return HttpResponse.text('override')
    }),
  )

  await page.goto('/')

  const data = await page.evaluate(async () => {
    const response = await fetch('/v1/objects/actual')
    return response.text()
  })

  expect(data).toBe('override')
})
