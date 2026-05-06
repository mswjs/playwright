import {
  CancelableCloseEvent,
  CancelableMessageEvent,
  WebSocketClientConnectionProtocol,
  type WebSocketClientEventMap,
  type WebSocketData,
  type WebSocketServerConnectionProtocol,
  type WebSocketServerEventMap,
} from '@mswjs/interceptors/WebSocket'
import type { WebSocketRoute } from '@playwright/test'
import { WebSocketNetworkFrame } from 'msw/experimental'
import { invariant } from 'outvariant'

import type { WebSocketHandler } from 'msw'
import type { NetworkFrameResolutionContext } from '../../node_modules/msw/lib/core/experimental/frames/network-frame.mjs'
import type { UnhandledFrameHandle } from '../../node_modules/msw/lib/core/experimental/on-unhandled-frame.mjs'

interface PlaywrightWebSocketNetworkFrameOptions {
  route: WebSocketRoute
  inferredBaseUrl?: string
}

export class PlaywrightWebSocketNetworkFrame extends WebSocketNetworkFrame {
  #route: WebSocketRoute
  #inferredBaseUrl?: string

  constructor(options: PlaywrightWebSocketNetworkFrameOptions) {
    super({
      connection: {
        // @ts-expect-error WebSocketClientConnectionProtocol not assignable to WebSocketClientConnection
        client: new PlaywrightWebSocketClientConnection(options.route),
        // @ts-expect-error WebSocketServerConnectionProtocol not assignable to WebSocketServerConnection
        server: new PlaywrightWebSocketServerConnection(options.route),
        info: { protocols: [] },
      },
    })
    this.#route = options.route
    this.#inferredBaseUrl = options.inferredBaseUrl
  }

  resolve(
    handlers: Array<WebSocketHandler>,
    onUnhandledFrame: UnhandledFrameHandle,
    resolutionContext?: NetworkFrameResolutionContext,
  ): Promise<boolean | null> {
    return super.resolve(handlers, onUnhandledFrame, {
      ...resolutionContext,
      baseUrl: this.#inferredBaseUrl,
    })
  }

  passthrough(): void {
    this.#route.connectToServer()
  }

  errorWith(reason?: unknown): void {
    if (!(reason instanceof Error)) return

    /** @note Playwright does support error events. Close with error instead. */
    this.#route.close({ code: 1011, reason: reason.message })
  }
}

class PlaywrightWebSocketClientConnection implements WebSocketClientConnectionProtocol {
  readonly #route: WebSocketRoute

  readonly id: string
  readonly url: URL

  constructor(route: WebSocketRoute) {
    this.#route = route
    this.id = crypto.randomUUID()
    this.url = new URL(route.url())
  }

  send(data: WebSocketData): void {
    if (data instanceof Blob) {
      /**
       * @note Playwright does not support sending Blob data.
       * Read the blob as buffer, then send the buffer instead.
       */
      data.bytes().then((bytes) => {
        this.#route.send(Buffer.from(bytes))
      })
      return
    }

    if (typeof data === 'string') {
      this.#route.send(data)
      return
    }

    this.#route.send(
      /**
       * @note Forcefully cast all data to Buffer because Playwright
       * has trouble digesting ArrayBuffer and Blob directly.
       */
      Buffer.from(
        /**
         * @note Playwright type definitions are tailored to Node.js
         * while MSW describes all data types that can be sent over
         * the WebSocket protocol, like ArrayBuffer and Blob.
         */
        data as any,
      ),
    )
  }

  close(code?: number, reason?: string): void {
    const resolvedCode = code ?? 1000
    this.#route.close({ code: resolvedCode, reason })
  }

  addEventListener<EventType extends keyof WebSocketClientEventMap>(
    type: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketClientEventMap[EventType],
    ) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    /**
     * @note Playwright does not expose the actual WebSocket reference.
     */
    const target = {} as WebSocket

    switch (type) {
      case 'message': {
        this.#route.onMessage((data) => {
          listener.call(
            target,
            new CancelableMessageEvent('message', { data }) as any,
          )
        })
        break
      }
      case 'close': {
        this.#route.onClose((code, reason) => {
          listener.call(
            target,
            new CancelableCloseEvent('close', { code, reason }) as any,
          )
        })
        break
      }
    }
  }

  removeEventListener<EventType extends keyof WebSocketClientEventMap>(
    event: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketClientEventMap[EventType],
    ) => void,
    options?: EventListenerOptions | boolean,
  ): void {
    console.warn(
      '@msw/playwright: WebSocketRoute does not support removing event listeners',
    )
  }
}

class PlaywrightWebSocketServerConnection implements WebSocketServerConnectionProtocol {
  readonly #route: WebSocketRoute
  #server?: WebSocketRoute
  #bufferedEvents: Array<
    Parameters<WebSocketServerConnectionProtocol['addEventListener']>
  >
  #bufferedData: Array<WebSocketData>

  constructor(route: WebSocketRoute) {
    this.#route = route
    this.#bufferedEvents = []
    this.#bufferedData = []
  }

  connect(): void {
    this.#server = this.#route.connectToServer()

    /**
     * @note Playwright does not support event buffering.
     * Manually add event listeners that might have been registered
     * before `connect()` was called.
     */
    for (const [type, listener, options] of this.#bufferedEvents) {
      this.addEventListener(type, listener, options)
    }
    this.#bufferedEvents.length = 0

    // Same for the buffered data.
    for (const data of this.#bufferedData) {
      this.send(data)
    }
    this.#bufferedData.length = 0
  }

  send(data: WebSocketData): void {
    if (this.#server == null) {
      this.#bufferedData.push(data)
      return
    }

    this.#server.send(data as any)
  }

  close(code?: number, reason?: string): void {
    invariant(
      this.#server,
      'Failed to close connection to the actual WebSocket server: connection not established. Did you forget to call `connect()`?',
    )

    this.#server.close({ code, reason })
  }

  addEventListener<EventType extends keyof WebSocketServerEventMap>(
    type: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketServerEventMap[EventType],
    ) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (this.#server == null) {
      this.#bufferedEvents.push([type, listener as any, options])
      return
    }

    const target = {} as WebSocket
    switch (type) {
      case 'message': {
        this.#server.onMessage((data) => {
          listener.call(
            target,
            new CancelableMessageEvent('message', { data }) as any,
          )
        })
        break
      }

      case 'close': {
        this.#server.onClose((code, reason) => {
          listener.call(
            target,
            new CancelableCloseEvent('close', { code, reason }) as any,
          )
        })
        break
      }
    }
  }

  removeEventListener<EventType extends keyof WebSocketServerEventMap>(
    type: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketServerEventMap[EventType],
    ) => void,
    options?: EventListenerOptions | boolean,
  ): void {
    console.warn(
      '@msw/playwright: WebSocketRoute does not support removing event listeners',
    )
  }
}
