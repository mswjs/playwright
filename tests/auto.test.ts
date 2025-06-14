import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import { createWorkerFixture, type WorkerFixture } from '../src/index.js'

interface Fixtures {
  worker: WorkerFixture
}

const test = testBase.extend<Fixtures>({
  worker: createWorkerFixture({
    initialHandlers: [
      http.get('*/resource', () => {
        return new Response('hello world')
      }),
    ],
  }),
})

test('automatically applies the worker fixture', async ({ page }) => {
  await page.goto('')
  const data = await page.evaluate(() => {
    return fetch('http://localhost/resource').then((response) => {
      return response.text()
    })
  })

  expect(data).toBe('hello world')
})
