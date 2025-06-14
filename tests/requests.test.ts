import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import { createWorkerFixture, type WorkerFixture } from '../src/index.js'

interface Fixtures {
  worker: WorkerFixture
}

const test = testBase.extend<Fixtures>({
  worker: createWorkerFixture(),
})

test('intercepts a GET request', async ({ worker, page }) => {
  const requestPromise = Promise.withResolvers<Request>()
  worker.use(
    http.get('*/resource', ({ request }) => {
      requestPromise.resolve(request)
    }),
  )

  await page.goto('')
  await page.evaluate(async () => {
    fetch('http://localhost/resource', {
      headers: {
        'x-test-header': 'test-value',
      },
    })
  })

  const request = await requestPromise.promise
  expect(request.method).toBe('GET')
  expect(request.url).toBe('http://localhost/resource')
  expect(Array.from(request.headers)).toContainEqual([
    'x-test-header',
    'test-value',
  ])
})

test('intercepts a POST request without any body', async ({ worker, page }) => {
  const requestPromise = Promise.withResolvers<Request>()
  worker.use(
    http.post('*/action', ({ request }) => {
      requestPromise.resolve(request)
    }),
  )

  await page.goto('')
  await page.evaluate(async () => {
    fetch('http://localhost/action', {
      method: 'POST',
      body: null,
    })
  })

  const request = await requestPromise.promise
  expect(request.method).toBe('POST')
  expect(request.url).toBe('http://localhost/action')
  expect(request.body).toBeNull()
})

test('intercepts a POST request with text body', async ({ worker, page }) => {
  const requestPromise = Promise.withResolvers<Request>()
  worker.use(
    http.post('*/action', ({ request }) => {
      requestPromise.resolve(request)
    }),
  )

  await page.goto('')
  await page.evaluate(async () => {
    fetch('http://localhost/action', {
      method: 'POST',
      body: 'hello world',
    })
  })

  const request = await requestPromise.promise
  expect(request.method).toBe('POST')
  expect(request.url).toBe('http://localhost/action')
  await expect(request.text()).resolves.toBe('hello world')
})

test('intercepts a POST request with array buffer body', async ({
  worker,
  page,
}) => {
  const requestPromise = Promise.withResolvers<Request>()
  worker.use(
    http.post('*/action', ({ request }) => {
      requestPromise.resolve(request)
    }),
  )

  await page.goto('')
  await page.evaluate(async () => {
    fetch('http://localhost/action', {
      method: 'POST',
      body: new TextEncoder().encode('hello world'),
    })
  })

  const request = await requestPromise.promise
  expect(request.method).toBe('POST')
  expect(request.url).toBe('http://localhost/action')
  await expect(request.text()).resolves.toBe('hello world')
})
