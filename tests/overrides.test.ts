import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture(),
})

test.beforeEach(({ network }) => {
  network.use(
    http.get('*', () => {
      return new HttpResponse('fallback')
    }),
  )
})

test('responds with the override mocked response', async ({
  network,
  page,
}) => {
  network.use(
    http.get('/resource', () => {
      return new HttpResponse('hello world')
    }),
  )

  await page.goto('/')

  const data = await page.evaluate(async () => {
    const response = await fetch('/resource')
    return response.text()
  })

  expect(data).toBe('hello world')
})

test('responds with a fallback response', async ({ page }) => {
  await page.goto('/')

  const data = await page.evaluate(async () => {
    const response = await fetch('/intentionally-unknown')
    return response.text()
  })

  expect(data).toBe('fallback')
})
