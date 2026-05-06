import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse, ws, type AnyHandler } from 'msw'
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
        routePattern: `/api/**`,
        websocketPattern: `**/realtime`,
      })

      /**
       * @note Fallback used to verify the "ignore" case. MUST be registered
       * before the network is enabled for the test to be meaningful, because
       * Playwright also picks most recently registered, matching routes first.
       */
      await context.route('/other/endpoint', (route) =>
        route.fulfill({ body: 'fallback response' }),
      )

      await network.enable()
      await use(network)
      await network.disable()
    },
    { auto: true },
  ],
})

test('intercepts an HTTP request matching the custom route pattern', async ({
  network,
  page,
}) => {
  network.use(
    http.get('/api/resource', () => {
      return HttpResponse.text('hello world')
    }),
  )

  await page.goto('/')

  const data = await page.evaluate(async () => {
    const response = await fetch('/api/resource')
    return response.text()
  })

  expect(data).toBe('hello world')
})

test('ignores HTTP request unrelated to the custom route pattern', async ({
  network,
  page,
}) => {
  network.use(
    http.get('/other/endpoint', () => {
      return HttpResponse.text('hello world')
    }),
  )

  await page.goto('/')

  const data = await page.evaluate(async () => {
    const response = await fetch('/other/endpoint')
    return response.text()
  })

  expect(data).toBe('fallback response')
})

test('intercepts a WebSocket connection matching the custom WebSocket pattern', async ({
  network,
  page,
}) => {
  const realtime = ws.link('ws://localhost/realtime')
  network.use(
    realtime.addEventListener('connection', ({ client }) => {
      client.send('hello world')
    }),
  )

  await page.goto('/')

  const message = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/realtime')

    return new Promise<string>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onmessage = (event) => {
        resolve(event.data)
      }
    })
  })

  expect(message).toBe('hello world')
})

test('ignores a WebSocket connection unrelated to the custom WebSocket pattern', async ({
  network,
  page,
}) => {
  const other = ws.link('ws://localhost/other')
  network.use(
    other.addEventListener('connection', ({ client }) => {
      client.send('hello world')
    }),
  )

  await page.goto('/')

  const connection = page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/other')

    return new Promise<string>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onmessage = (event) => {
        resolve(event.data)
      }
    })
  })

  expect(connection).rejects.toThrow('WebSocket connection failed')
})
