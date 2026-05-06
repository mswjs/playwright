import type { BrowserContext, Page } from '@playwright/test'
import { type AnyHandler, type UnhandledRequestStrategy } from 'msw'
import { defineNetwork } from 'msw/experimental'
import {
  PlaywrightSource,
  type PlaywrightSourceOptions,
} from './playwright-source.js'

import { fromLegacyOnUnhandledRequest } from '../node_modules/msw/lib/core/experimental/compat.mjs'
import {
  NetworkReadyState,
  type NetworkApi,
} from '../node_modules/msw/lib/core/experimental/define-network.mjs'

export interface NetworkFixture extends Pick<
  NetworkApi<[PlaywrightSource]>,
  | 'enable'
  | 'disable'
  | 'use'
  | 'restoreHandlers'
  | 'resetHandlers'
  | 'listHandlers'
  | 'events'
> {}

export interface NetworkFixtureOptions extends PlaywrightSourceOptions {
  context: BrowserContext | Page
  handlers?: Array<AnyHandler>
  onUnhandledRequest?: UnhandledRequestStrategy
}

export function defineNetworkFixture(
  options: NetworkFixtureOptions,
): NetworkFixture {
  const network = defineNetwork({
    sources: [
      new PlaywrightSource(options.context, options),
    ],
    onUnhandledFrame: fromLegacyOnUnhandledRequest(
      () => options.onUnhandledRequest || 'bypass',
    ),
    handlers: options.handlers,
    context: { quiet: true },
  })

  return {
    events: network.events,
    enable: network.enable.bind(network),
    use: network.use.bind(network),
    restoreHandlers: network.restoreHandlers.bind(network),
    resetHandlers: network.resetHandlers.bind(network),
    listHandlers: network.listHandlers.bind(network),
    disable() {
      /**
       * @note Ignore closing after closed for backwards compatibility.
       */
      if (network.readyState === NetworkReadyState.DISABLED) {
        return Promise.resolve()
      }
      return network.disable()
    },
  }
}
