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

test('sends a mocked event to the client', async ({ worker, page }) => {
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
