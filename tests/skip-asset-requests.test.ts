import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture(),
})

test('skips asset requests by default', async ({ network, page }) => {
  network.use(
    http.get('/index.html', () => {
      throw new Error('Must never see this')
    }),
  )

  await page.goto('/')
  const responseBody = await page.evaluate(async () => {
    const res = await fetch('/index.html')
    return res.text()
  })

  expect(responseBody).toContain('<!DOCTYPE html')
})

const testWithAssets = testBase.extend<Fixtures>({
  network: createNetworkFixture({
    skipAssetRequests: false,
  }),
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
