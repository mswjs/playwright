import { test as testBase, expect } from '@playwright/test'
import { ws, type AnyHandler } from 'msw'
import { graphql } from 'msw/graphql'
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

test('exposes the protocols requested by the client', async ({
  network,
  page,
}) => {
  const api = ws.link('ws://localhost/api')

  network.use(
    api.addEventListener('connection', ({ client, info }) => {
      client.send(JSON.stringify(info.protocols))
    }),
  )

  await page.goto('')

  const protocols = await page.evaluate(() => {
    const ws = new WebSocket('ws://localhost/api', ['chat.v1', 'chat.v2'])

    return new Promise<string>((resolve, reject) => {
      ws.onerror = () => reject(new Error('WebSocket connection failed'))
      ws.onmessage = (event) => resolve(event.data)
    })
  })

  expect(JSON.parse(protocols)).toEqual(['chat.v1', 'chat.v2'])
})
