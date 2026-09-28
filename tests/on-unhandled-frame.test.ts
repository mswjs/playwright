import { test as testBase, expect } from '@playwright/test'
import sinon from 'sinon'
import type { AnyHandler } from 'msw'
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
        onUnhandledFrame: 'warn',
      })

      await network.enable()
      await use(network)
      await network.disable()
    },
    { auto: true },
  ],
})

test.afterAll(() => {
  sinon.restore()
})

test('prints a warning on an unhandled request', async ({ page }) => {
  const consoleSpy = sinon.stub(console, 'warn')

  await page.goto('/')
  await page.evaluate(() => fetch('/unhandled'))

  expect(consoleSpy.args).toContainEqual([
    `[MSW] Warning: intercepted a request without a matching request handler:

  • GET http://localhost:5173/unhandled

If you still wish to intercept this unhandled request, please create a request handler for it.
Read more: https://mswjs.io/docs/http/intercepting-requests`,
  ])
})

test('prints a warning on an unhandled WebSocket connection', async ({
  page,
}) => {
  const consoleSpy = sinon.stub(console, 'warn')

  await page.goto('/')
  await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/unhandled')
    return new Promise<void>((resolve) => {
      ws.onerror = () => resolve()
      ws.onclose = () => resolve()
      ws.onopen = () => resolve()
    })
  })

  expect(consoleSpy.args).toContainEqual([
    `[MSW] Warning: intercepted a WebSocket connection without a matching event handler:

  • ws://localhost/unhandled

If you still wish to intercept this unhandled connection, please create an event handler for it.
Read more: https://mswjs.io/docs/websocket`,
  ])
})
