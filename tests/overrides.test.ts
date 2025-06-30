import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  worker: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  worker: createNetworkFixture(),
})

test.beforeEach(({ worker }) => {
  worker.use(
    http.get('*', () => {
      return new Response('fallback')
    }),
  )
})

test('responds with the override mocked response', async ({ worker, page }) => {
  worker.use(
    http.get('*/resource', () => {
      return new Response('hello world')
    }),
  )

  await page.goto('')
  const data = await page.evaluate(() => {
    return fetch('http://localhost/resource').then((response) => {
      return response.text()
    })
  })

  expect(data).toBe('hello world')
})

test('responds with a fallback response', async ({ page }) => {
  await page.goto('')
  const data = await page.evaluate(() => {
    return fetch('http://localhost/intentionally-unknown').then((response) => {
      return response.text()
    })
  })

  expect(data).toBe('fallback')
})
