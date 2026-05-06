import type {
  BrowserContext,
  Page,
  Route,
  WebSocketRoute,
} from '@playwright/test'
import { isCommonAssetRequest } from 'msw'
import { NetworkSource } from 'msw/experimental'
import { PlaywrightHttpNetworkFrame } from './frames/http-frame.js'
import { PlaywrightWebSocketNetworkFrame } from './frames/websocket-frame.js'
import {
  convertToRequest,
  inferPageBaseUrl,
  inferRouteBaseUrl,
  passthroughRequest,
  registerRouteHandler,
  registerWebSocketRouteHandler,
  type UnrouteFn,
} from './route-utils.js'

export interface PlaywrightSourceOptions {
  /**
   * Skip common asset requests (e.g. `*.html`, `*.css`, `*.js`, etc).
   * This improves performance for certain projects.
   * @default true
   *
   * @see https://mswjs.io/docs/api/is-common-asset-request
   */
  skipAssetRequests?: boolean
  /**
   * A custom route pattern used when registering a Playwright route handler.
   *
   * @see https://playwright.dev/docs/api/class-page#page-route-option-url
   */
  routePattern?: Parameters<Page['route']>[0]
  /**
   * A custom route pattern used when registering a Playwright WebSocket route handler.
   *
   * @see https://playwright.dev/docs/api/class-page#page-route-web-socket-option-url
   */
  websocketPattern?: Parameters<Page['route']>[0]
}

export class PlaywrightSource extends NetworkSource<
  PlaywrightHttpNetworkFrame | PlaywrightWebSocketNetworkFrame
> {
  #target: BrowserContext | Page
  #options: Required<PlaywrightSourceOptions>

  #routeCleanup: UnrouteFn | null = null
  #wsRouteCleanup: UnrouteFn | null = null

  constructor(
    target: BrowserContext | Page,
    options?: PlaywrightSourceOptions,
  ) {
    super()
    this.#target = target
    this.#options = {
      skipAssetRequests: true,
      routePattern: '**',
      websocketPattern: '**',
      ...options,
    }
  }

  async enable(): Promise<void> {
    this.#routeCleanup ??= await registerRouteHandler(
      this.#target,
      this.#options.routePattern,
      this.#handleRequestRoute.bind(this),
    )
    this.#wsRouteCleanup ??= await registerWebSocketRouteHandler(
      this.#target,
      this.#options.websocketPattern,
      this.#handleWebSocketRoute.bind(this),
    )
  }

  async disable(): Promise<void> {
    super.disable()
    await this.#routeCleanup?.()
    await this.#wsRouteCleanup?.()
    this.#routeCleanup = null
    this.#wsRouteCleanup = null
  }

  async #handleRequestRoute(route: Route): Promise<void> {
    const request = await convertToRequest(route)

    /**
     * @note Skip common asset requests (default).
     * Playwright seems to experience performance degradation when routing all
     * requests through the matching logic below.
     * @see https://github.com/mswjs/playwright/issues/13
     */
    if (this.#options.skipAssetRequests && isCommonAssetRequest(request)) {
      return await passthroughRequest(route)
    }

    const frame = new PlaywrightHttpNetworkFrame({
      route,
      request,
      inferredBaseUrl: inferRouteBaseUrl(route),
    })
    await this.queue(frame)
  }

  async #handleWebSocketRoute(route: WebSocketRoute): Promise<void> {
    const frame = new PlaywrightWebSocketNetworkFrame({
      route,
      inferredBaseUrl: inferPageBaseUrl(this.#target),
    })
    await this.queue(frame)
  }
}
