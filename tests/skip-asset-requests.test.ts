import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse, type AnyHandler } from 'msw'
import { defineNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  handlers: Array<AnyHandler>
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  handlers: [[], { option: true }],
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

test('skips asset requests by default', async ({ network, page }) => {
  network.use(
    http.get('/index.html', () => {
      throw new Error('Must never see this')
    }),
  )

  await page.goto('/')
  const responseBody = await page.evaluate(async () => {
    const response = await fetch('/index.html')
    return response.text()
  })

  expect(responseBody).toContain('<!DOCTYPE html')
})

const testWithAssets = testBase.extend<Fixtures>({
  handlers: [[], { option: true }],
  network: [
    async ({ context, handlers }, use) => {
      const network = defineNetworkFixture({
        context,
        handlers,
        skipAssetRequests: false,
      })

      await network.enable()
      await use(network)
      await network.disable()
    },
    { auto: true },
  ],
})

testWithAssets(
  'intercepts asset requests when `skipAssetRequests` is set to false',
  async ({ network, page }) => {
    network.use(
      http.get('/index.html', () => {
        return HttpResponse.text('Mocked HTML')
      }),
    )

    await page.goto('/')

    const responseBody = await page.evaluate(async () => {
      const response = await fetch('/index.html')
      return response.text()
    })

    expect(responseBody).toBe('Mocked HTML')
  },
)
