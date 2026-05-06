import type { Route } from '@playwright/test'
import { HttpNetworkFrame } from 'msw/experimental'
import {
  abortRequest,
  fulfillResponse,
  passthroughRequest,
} from '../route-utils.js'

import type { RequestHandler } from 'msw'
import type { NetworkFrameResolutionContext } from '../../node_modules/msw/lib/core/experimental/frames/network-frame.mjs'
import type { UnhandledFrameHandle } from '../../node_modules/msw/lib/core/experimental/on-unhandled-frame.mjs'

interface PlaywrightHttpNetworkFrameOptions {
  request: Request
  id?: string
  route: Route
  inferredBaseUrl?: string
}

export class PlaywrightHttpNetworkFrame extends HttpNetworkFrame {
  #route: Route
  #inferredBaseUrl?: string

  constructor(options: PlaywrightHttpNetworkFrameOptions) {
    super(options)
    this.#route = options.route
    this.#inferredBaseUrl = options.inferredBaseUrl
  }

  resolve(
    handlers: Array<RequestHandler>,
    onUnhandledFrame: UnhandledFrameHandle,
    resolutionContext?: NetworkFrameResolutionContext,
  ): Promise<boolean | null> {
    return super.resolve(handlers, onUnhandledFrame, {
      ...resolutionContext,
      baseUrl: this.#inferredBaseUrl,
    })
  }

  async respondWith(response?: Response): Promise<void> {
    if (!response) return

    if (response.status === 0) {
      return await abortRequest(this.#route)
    }

    return await fulfillResponse(this.#route, response)
  }

  passthrough(): Promise<void> {
    return passthroughRequest(this.#route)
  }

  errorWith(reason?: unknown): Promise<void> {
    if (reason instanceof Response) {
      return fulfillResponse(this.#route, reason)
    }

    return abortRequest(this.#route)
  }
}
