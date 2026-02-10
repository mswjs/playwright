/**
 * @see https://github.com/mswjs/playwright/issues/26
 */
import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse, type AnyHandler } from 'msw'
import { defineNetworkFixture, type NetworkFixture } from '../../src/index.js'

interface Fixtures {
  handlers: Array<AnyHandler>
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  handlers: [
    [
      // A permissive wildcard handler.
      http.get('*/objects/:tableName', () => {
        return HttpResponse.text('initial')
      }),
    ],
    { option: true },
  ],
  network: [
    async ({ context, handlers }, use) => {
      const network = defineNetworkFixture({
        context,
        handlers,
      })

      await network.enable()
      await use(network)
      await network.disable()
    },
    { auto: true },
  ],
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
