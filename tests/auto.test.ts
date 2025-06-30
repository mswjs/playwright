import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture({
    initialHandlers: [
      http.get('*/resource', () => {
        return new Response('hello world')
      }),
    ],
  }),
})

test('automatically applies the network fixture', async ({ page }) => {
  await page.goto('')
  const data = await page.evaluate(() => {
    return fetch('http://localhost/resource').then((response) => {
      return response.text()
    })
  })

  expect(data).toBe('hello world')
})
