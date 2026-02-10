import { test as testBase, expect } from '@playwright/test'
import { http, HttpResponse, type AnyHandler } from 'msw'
import { defineNetworkFixture, type NetworkFixture } from '../src/fixture.js'

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

test('mocks a response without any body', async ({ network, page }) => {
  network.use(
    http.get('/null', () => {
      return new HttpResponse(null)
    }),
  )

  await page.goto('/')

  const response = await page.evaluate(async () => {
    const response = await fetch('/null')
    return response.text()
  })

  /**
   * @note Playwright doesn't seem to support responding with
   * a mocked response that has `null` as its body.
   */
  expect(response).toBe('')
})

test('mocks a response with a text body', async ({ network, page }) => {
  network.use(
    http.get('/text', () => {
      return HttpResponse.text('Hello world!')
    }),
  )

  await page.goto('/')

  const response = await page.evaluate(async () => {
    const response = await fetch('/text')
    return response.text()
  })

  expect(response).toBe('Hello world!')
})

test('mocks a response with a json body', async ({ network, page }) => {
  network.use(
    http.get('/json', () => {
      return HttpResponse.json({ hello: 'world' })
    }),
  )

  await page.goto('/')

  const response = await page.evaluate(async () => {
    const response = await fetch('/json')
    return response.json()
  })

  expect(response).toEqual({ hello: 'world' })
})

test('mocks a response with an ArrayBuffer body', async ({ network, page }) => {
  network.use(
    http.get('/arrayBuffer', () => {
      return HttpResponse.arrayBuffer(
        new TextEncoder().encode('hello world').buffer,
      )
    }),
  )

  await page.goto('/')

  const response = await page.evaluate(async () => {
    const response = await fetch('/arrayBuffer')
    const data = await response.arrayBuffer()
    return new TextDecoder().decode(data)
  })

  expect(response).toBe('hello world')
})

test('mocks a response with an FormData body', async ({ network, page }) => {
  network.use(
    http.get('/formData', () => {
      const data = new FormData()
      data.set('hello', 'world')
      return HttpResponse.formData(data)
    }),
  )

  await page.goto('/')

  const response = await page.evaluate(async () => {
    const response = await fetch('/formData')
    const data = await response.formData()
    return Array.from(data.entries())
  })

  expect(response).toEqual([['hello', 'world']])
})

test('mocks a response with a stream', async ({ network, page }) => {
  network.use(
    http.get('/stream', () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello'))
          controller.enqueue(new TextEncoder().encode(' '))
          controller.enqueue(new TextEncoder().encode('world'))
          controller.close()
        },
      })
      return new HttpResponse(stream)
    }),
  )

  await page.goto('/')

  const response = await page.evaluate(async () => {
    const response = await fetch('/stream')
    return response.text()
  })

  expect(response).toBe('hello world')
})

test('mocks a network error', async ({ network, page }) => {
  network.use(
    http.get('/network-error', () => {
      return HttpResponse.error()
    }),
  )

  await page.goto('/')

  const errorMessage = await page.evaluate<string>(() => {
    return fetch('/network-error').then(
      () => {
        throw new Error('Must not return a successful response')
      },
      (error) => error,
    )
  })

  expect(errorMessage).toEqual(new TypeError('Failed to fetch'))
})
