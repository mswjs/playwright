import { test as testBase, expect } from '@playwright/test'
import { createTestHttpServer } from '@epic-web/test-server/http'
import { createWebSocketMiddleware } from '@epic-web/test-server/ws'
import { ws } from 'msw'
import { createWorkerFixture, type WorkerFixture } from '../src/index.js'

interface Fixtures {
  worker: WorkerFixture
}

const test = testBase.extend<Fixtures>({
  worker: createWorkerFixture(),
})

const api = ws.link('ws://localhost/api')

test('sends a text data to the client', async ({ worker, page }) => {
  worker.use(
    api.addEventListener('connection', ({ client }) => {
      client.send('hello world')
    }),
  )

  await page.goto('')

  const message = await page
    .evaluate(() => {
      const ws = new WebSocket('ws://localhost/api')

      return new Promise<string>((resolve, reject) => {
        ws.onerror = () => reject(new Error('WebSocket connection failed'))
        ws.onmessage = (event) => {
          resolve(event.data)
        }
      })
    })
    .catch(() => void 0)

  expect(message).toBe('hello world')
})

test('sends a buffer data to the client', async ({ worker, page }) => {
  worker.use(
    api.addEventListener('connection', ({ client }) => {
      client.send(new TextEncoder().encode('hello world'))
    }),
  )

  await page.goto('')

  const message = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/api')

    return new Promise<string>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onmessage = async (event) => {
        /**
         * @note Playwright translates Buffer data to Blob.
         */
        if (event.data instanceof Blob) {
          resolve(await event.data.text())
        }
      }
    })
  })

  expect(message).toBe('hello world')
})

test('sends a blob data to the client', async ({ worker, page }) => {
  worker.use(
    api.addEventListener('connection', ({ client }) => {
      client.send(new Blob(['hello world']))
    }),
  )

  await page.goto('')

  const message = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/api')

    return new Promise<string>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          resolve(await event.data.text())
        }
      }
    })
  })

  expect(message).toBe('hello world')
})

test('closes the client connection', async ({ worker, page }) => {
  worker.use(
    api.addEventListener('connection', ({ client }) => {
      queueMicrotask(() => client.close())
    }),
  )

  await page.goto('')

  const wasClosed = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/api')

    return new Promise<{ code: number; reason?: string }>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onclose = (event) =>
        resolve({ code: event.code, reason: event.reason })
    })
  })

  expect(wasClosed).toEqual({
    code: 1000,
    reason: '',
  })
})

test('closes the client connection with a custom reason', async ({
  worker,
  page,
}) => {
  worker.use(
    api.addEventListener('connection', ({ client }) => {
      queueMicrotask(() => client.close(1000, 'My reason'))
    }),
  )

  await page.goto('')

  const wasClosed = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/api')

    return new Promise<{ code: number; reason?: string }>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onclose = (event) =>
        resolve({ code: event.code, reason: event.reason })
    })
  })

  expect(wasClosed).toEqual({
    code: 1000,
    reason: 'My reason',
  })
})

test('closes the client connection with a non-configurable code', async ({
  worker,
  page,
}) => {
  worker.use(
    api.addEventListener('connection', ({ client }) => {
      queueMicrotask(() => client.close(1003))
    }),
  )

  await page.goto('')

  const wasClosed = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/api')

    return new Promise<{ code: number; reason?: string }>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onclose = (event) =>
        resolve({ code: event.code, reason: event.reason })
    })
  })

  expect(wasClosed).toEqual({
    code: 1003,
    reason: '',
  })
})

test('connects to the actual server', async ({ worker, page }) => {
  await using httpServer = await createTestHttpServer({
    protocols: ['http']
  })
  await using wss = createWebSocketMiddleware({
    server: httpServer,
    pathname: '/ws'
  })

  wss.on('connection', (ws) => {
    ws.addEventListener('message', (event) => {
      console.log('server received:', event.data)
    })
  })

  const wsUrl = wss.ws.url().href
  const link = ws.link(wsUrl)
  worker.use(
    link.addEventListener('connection', ({ server }) => {
      server.connect()
      server.send('hello from the client')
    })
  )

  await page.goto('')

   const wasOpened = await page.evaluate((wsUrl) => {
    const ws = new WebSocket(wsUrl)

    return new Promise<boolean>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onopen = () => resolve(true)
    })
  }, wsUrl)

  expect(wasOpened).toBe(true)
})
