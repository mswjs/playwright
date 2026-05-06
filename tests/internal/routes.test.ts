/**
 * @note This test suite aims to verify the fixture's operability
 * with Playwright internals. It is not ideal but the best we can do,
 * given Playwright doesn't expose proper means to list route handlers.
 */
import {
  test as testBase,
  expect,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import type { AnyHandler } from 'msw'
import { defineNetworkFixture, type NetworkFixture } from '../../src/index.js'

interface Fixtures {
  handlers: Array<AnyHandler>
  network: NetworkFixture
  target: BrowserContext | Page
}

const DEFAULT_PATTERN = '**'
const targets = ['context', 'page'] as const

for (const target of targets) {
  const test = testBase.extend<Fixtures>({
    target: ({ context, page }, use) =>
      use(target === 'context' ? context : page),
    handlers: [[], { option: true }],
    network: [
      async ({ target, handlers }, use) => {
        const network = defineNetworkFixture({
          context: target,
          handlers,
        })

        await network.enable()
        await use(network)
        await network.disable()
      },
      { auto: true },
    ],
  })

  test.describe(`registering routes on target "${target}"`, () => {
    test('registers a single HTTP route', async ({ target }) => {
      expect(Reflect.get(target, '_routes')).toEqual([
        expect.objectContaining({ url: DEFAULT_PATTERN }),
      ])
    })

    test('unroutes the HTTP route when the fixture is stopped', async ({
      target,
      network,
    }) => {
      await network.disable()
      expect(Reflect.get(target, '_routes')).toEqual([])
    })

    test('preserves user-defined HTTP routes', async ({ target, network }) => {
      const routeHandler = () => {}
      await target.route('/user-defined', routeHandler)

      expect(Reflect.get(target, '_routes')).toEqual([
        expect.objectContaining({
          url: '/user-defined',
          handler: routeHandler,
        }),
        expect.objectContaining({ url: DEFAULT_PATTERN }),
      ])

      await network.disable()
      expect(Reflect.get(target, '_routes')).toEqual([
        expect.objectContaining({
          url: '/user-defined',
          handler: routeHandler,
        }),
      ])
    })

    test('preserves user-defined HTTP routes with the same pattern', async ({
      target,
      network,
    }) => {
      const routeHandler = () => {}
      await target.route(DEFAULT_PATTERN, routeHandler)

      expect(Reflect.get(target, '_routes')).toEqual([
        expect.objectContaining({
          url: DEFAULT_PATTERN,
          handler: routeHandler,
        }),
        expect.objectContaining({ url: DEFAULT_PATTERN }),
      ])

      await network.disable()
      expect(Reflect.get(target, '_routes')).toEqual([
        expect.objectContaining({
          url: DEFAULT_PATTERN,
          handler: routeHandler,
        }),
      ])
    })

    test('registers a single WebSocket handler', async ({ target }) => {
      expect(Reflect.get(target, '_webSocketRoutes')).toEqual([
        expect.objectContaining({ url: DEFAULT_PATTERN }),
      ])
    })

    test('unroutes the WebSocket handler when the fixture is stopped', async ({
      target,
      network,
    }) => {
      await network.disable()
      expect(Reflect.get(target, '_webSocketRoutes')).toEqual([])
    })

    test('preserves user-defined WebSocket routes', async ({
      target,
      network,
    }) => {
      const routeHandler = () => {}
      await target.routeWebSocket('/user-defined', routeHandler)

      expect(Reflect.get(target, '_webSocketRoutes')).toEqual([
        expect.objectContaining({
          url: '/user-defined',
          handler: routeHandler,
        }),
        expect.objectContaining({ url: DEFAULT_PATTERN }),
      ])

      await network.disable()
      expect(Reflect.get(target, '_webSocketRoutes')).toEqual([
        expect.objectContaining({
          url: '/user-defined',
          handler: routeHandler,
        }),
      ])
    })

    test('preserves user-defined WebSocket routes with the same pattern', async ({
      target,
      network,
    }) => {
      const routeHandler = () => {}
      await target.routeWebSocket(DEFAULT_PATTERN, routeHandler)

      expect(Reflect.get(target, '_webSocketRoutes')).toEqual([
        expect.objectContaining({
          url: DEFAULT_PATTERN,
          handler: routeHandler,
        }),
        expect.objectContaining({ url: DEFAULT_PATTERN }),
      ])

      await network.disable()
      expect(Reflect.get(target, '_webSocketRoutes')).toEqual([
        expect.objectContaining({
          url: DEFAULT_PATTERN,
          handler: routeHandler,
        }),
      ])
    })
  })
}
