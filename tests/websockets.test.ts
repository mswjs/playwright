import { test as testBase, expect } from '@playwright/test'
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
