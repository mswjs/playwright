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
      })

      await network.enable()
      await use(network)
      await network.disable()
    },
    { auto: true },
  ],
})

test('intercepts an HTTP request on a programmatically created page', async ({
  network,
  context,
}) => {
  network.use(
    http.get('/resource', () => {
      return HttpResponse.text('hello world')
    }),
  )

  const newPage = await context.newPage()
  await newPage.goto('/')

  const data = await newPage.evaluate(async () => {
    const response = await fetch('/resource')
    return response.text()
  })

  expect(data).toBe('hello world')
})

test('intercepts a WebSocket connection on a programmatically created page', async ({
  network,
  context,
}) => {
  const api = ws.link('ws://localhost:5173/api')

  network.use(
    api.addEventListener('connection', ({ client }) => {
      client.send('hello world')
    }),
  )

  const newPage = await context.newPage()
  await newPage.goto('/')

  const message = await newPage.evaluate(() => {
    const pendingMessage = Promise.withResolvers<string>()

    const ws = new WebSocket('/api')
    ws.onmessage = (event) => {
      pendingMessage.resolve(event.data)
    }
    ws.onerror = () => pendingMessage.reject('WebSocket connection errored')

    return pendingMessage.promise
  })

  expect(message).toBe('hello world')
})
