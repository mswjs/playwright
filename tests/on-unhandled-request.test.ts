import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import sinon from 'sinon'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture({
    onUnhandledRequest: 'warn',
  }),
})

test.afterAll(() => {
  sinon.restore()
})

test('prints a warning on an unhandled request', async ({ page, network }) => {
  const consoleSpy = sinon.stub(console, 'warn')

  await page.goto('/')
  await page.evaluate(() => fetch('/unhandled'))

  expect.soft(consoleSpy.callCount).toBe(2)
  expect(consoleSpy.getCall(1).args).toEqual([
    `[MSW] Warning: intercepted a request without a matching request handler:

  • GET http://localhost:5173/unhandled

If you still wish to intercept this unhandled request, please create a request handler for it.
Read more: https://mswjs.io/docs/http/intercepting-requests`,
  ])
})
