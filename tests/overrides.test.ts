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

test('responds with a fallback response', async ({ network, page }) => {
  network.use(
    http.get('*', () => {
      return new HttpResponse('fallback')
    }),
  )

  await page.goto('/')

  const data = await page.evaluate(async () => {
    const response = await fetch('/intentionally-unknown')
    return response.text()
  })

  expect(data).toBe('fallback')
})

test('respects manual overrides added via `context.route`', async ({
  context,
  page,
}) => {
  await page.goto('/')

  await context.route('/resource', (route) => {
    return route.fulfill({ body: 'manual-override' })
  })

  const data = await page.evaluate(async () => {
    const response = await fetch('/resource')
    return response.text()
  })

  expect(data).toBe('manual-override')
})

test('respects manual overrides added via `page.route`', async ({ page }) => {
  await page.goto('/')

  await page.route('/resource', (route) => {
    return route.fulfill({ body: 'manual-override' })
  })

  const data = await page.evaluate(async () => {
    const response = await fetch('/resource')
    return response.text()
  })

  expect(data).toBe('manual-override')
})
