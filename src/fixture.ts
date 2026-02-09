import { invariant } from 'outvariant'
import type {
  BrowserContext,
  Page,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
  Request as PlaywrightRequest,
  Route,
  TestFixture,
  WebSocketRoute,
} from '@playwright/test'
import {
  type LifeCycleEventsMap,
  type UnhandledRequestStrategy,
  SetupApi,
  RequestHandler,
  WebSocketHandler,
  handleRequest,
} from 'msw'
import {
  type WebSocketClientEventMap,
  type WebSocketData,
  type WebSocketServerEventMap,
  CancelableMessageEvent,
  CancelableCloseEvent,
  WebSocketClientConnectionProtocol,
  WebSocketServerConnectionProtocol,
} from '@mswjs/interceptors/WebSocket'

export interface CreateNetworkFixtureArgs {
  initialHandlers?: Array<RequestHandler | WebSocketHandler>
  onUnhandledRequest?: UnhandledRequestStrategy
}

/**
 * Creates a fixture that controls the network in your tests.
 *
 * @note The returned fixture already has the `auto` option set to `true`.
 *
 * **Usage**
 * ```ts
 * import { test as testBase } from '@playwright/test'
 * import { createNetworkFixture, type WorkerFixture } from '@msw/playwright'
 *
 * interface Fixtures {
 *  network: WorkerFixture
 * }
 *
 * export const test = testBase.extend<Fixtures>({
 *   network: createNetworkFixture()
 * })
 * ```
 */
export function createNetworkFixture(
  args?: CreateNetworkFixtureArgs,
): [
  TestFixture<NetworkFixture, PlaywrightTestArgs & PlaywrightWorkerArgs>,
  { auto: boolean },
] {
  return [
    async ({ context }, use) => {
      const worker = new NetworkFixture({
        context,
        initialHandlers: args?.initialHandlers || [],
        onUnhandledRequest: args?.onUnhandledRequest,
      })

      await worker.start()
      await use(worker)
      await worker.stop()
    },
    { auto: true },
  ]
}

/**
 * @note Use a match-all RegExp with an optional group as the predicate
 * for the `page.route()`/`page.unroute()` calls. Playwright treats given RegExp
 * as the handler ID, which allows us to remove only those handlers introduces by us
 * without carrying the reference to the handler function around.
 */
export const INTERNAL_MATCH_ALL_REG_EXP = /.+(__MSW_PLAYWRIGHT_PREDICATE__)?/

export class NetworkFixture extends SetupApi<LifeCycleEventsMap> {
  constructor(
    protected args: {
      context: BrowserContext
      initialHandlers: Array<RequestHandler | WebSocketHandler>
      onUnhandledRequest?: UnhandledRequestStrategy
    },
  ) {
    super(...args.initialHandlers)
  }

  public async start(): Promise<void> {
    // Handle HTTP requests.
    await this.args.context.route(
      INTERNAL_MATCH_ALL_REG_EXP,
      async (route: Route, request: PlaywrightRequest) => {
        const fetchRequest = new Request(request.url(), {
          method: request.method(),
          headers: new Headers(await request.allHeaders()),
          body: request.postDataBuffer(),
        })

        const handlers = this.handlersController
          .currentHandlers()
          .filter((handler) => {
            return handler instanceof RequestHandler
          })

        const baseUrl = request.headers().referer
          ? new URL(request.headers().referer).origin
          : undefined

        /**
         * @note Use `handleRequest` instead of `getResponse` so we can pass
         * the `onUnhandledRequest` option as-is and benefit from MSW's default behaviors.
         */
        const response = await handleRequest(
          fetchRequest,
          crypto.randomUUID(),
          handlers,
          {
            onUnhandledRequest: this.args.onUnhandledRequest || 'bypass',
          },
          this.emitter,
          {
            resolutionContext: {
              quiet: true,
              baseUrl,
            },
          },
        )

        if (response) {
          if (response.status === 0) {
            return route.abort()
          }

          return route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: response.body
              ? Buffer.from(await response.arrayBuffer())
              : undefined,
          })
        }

        return route.continue()
      },
    )

    // Handle WebSocket connections.
    await this.args.context.routeWebSocket(
      INTERNAL_MATCH_ALL_REG_EXP,
      async (route) => {
        const allWebSocketHandlers = this.handlersController
          .currentHandlers()
          .filter((handler) => {
            return handler instanceof WebSocketHandler
          })

        if (allWebSocketHandlers.length === 0) {
          route.connectToServer()
          return
        }

        const client = new PlaywrightWebSocketClientConnection(route)
        const server = new PlaywrightWebSocketServerConnection(route)

        const pages = this.args.context.pages()
        const lastPage = pages[pages.length - 1]
        const baseUrl = lastPage ? this.getPageUrl(lastPage) : undefined

        for (const handler of allWebSocketHandlers) {
          await handler.run(
            {
              client,
              server,
              info: { protocols: [] },
            },
            {
              baseUrl,
            },
          )
        }
      },
    )
  }

  public async stop(): Promise<void> {
    super.dispose()
    await this.args.context.unroute(INTERNAL_MATCH_ALL_REG_EXP)
    await unrouteWebSocket(this.args.context, INTERNAL_MATCH_ALL_REG_EXP)
  }

  private getPageUrl(page: Page): string | undefined {
    const url = page.url()

    if (url === 'about:blank') {
      return
    }

    // Encode/decode to preserve escape characters.
    return decodeURI(new URL(encodeURI(url)).origin)
  }
}

class PlaywrightWebSocketClientConnection implements WebSocketClientConnectionProtocol {
  public id: string
  public url: URL

  constructor(protected readonly ws: WebSocketRoute) {
    this.id = crypto.randomUUID()
    this.url = new URL(ws.url())
  }

  public send(data: WebSocketData): void {
    if (data instanceof Blob) {
      /**
       * @note Playwright does not support sending Blob data.
       * Read the blob as buffer, then send the buffer instead.
       */
      data.bytes().then((bytes) => {
        this.ws.send(Buffer.from(bytes))
      })
      return
    }

    if (typeof data === 'string') {
      this.ws.send(data)
      return
    }

    this.ws.send(
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

  public close(code?: number, reason?: string): void {
    const resolvedCode = code ?? 1000
    this.ws.close({ code: resolvedCode, reason })
  }

  public addEventListener<EventType extends keyof WebSocketClientEventMap>(
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
        this.ws.onMessage((data) => {
          listener.call(
            target,
            new CancelableMessageEvent('message', {
              data,
            }) as any,
          )
        })
        break
      }

      case 'close': {
        this.ws.onClose((code, reason) => {
          listener.call(
            target,
            new CancelableCloseEvent('close', {
              code,
              reason,
            }) as any,
          )
        })
        break
      }
    }
  }

  public removeEventListener<EventType extends keyof WebSocketClientEventMap>(
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
  #server?: WebSocketRoute
  #bufferedEvents: Array<
    Parameters<WebSocketServerConnectionProtocol['addEventListener']>
  >
  #bufferedData: Array<WebSocketData>

  constructor(protected readonly ws: WebSocketRoute) {
    this.#bufferedEvents = []
    this.#bufferedData = []
  }

  public connect(): void {
    this.#server = this.ws.connectToServer()

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

  public send(data: WebSocketData): void {
    if (this.#server == null) {
      this.#bufferedData.push(data)
      return
    }

    this.#server.send(data as any)
  }

  public close(code?: number, reason?: string): void {
    invariant(
      this.#server,
      'Failed to close connection to the actual WebSocket server: connection not established. Did you forget to call `connect()`?',
    )

    this.#server.close({ code, reason })
  }

  public addEventListener<EventType extends keyof WebSocketServerEventMap>(
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

  public removeEventListener<EventType extends keyof WebSocketServerEventMap>(
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

interface InternalWebSocketRoute {
  url: Parameters<Page['routeWebSocket']>[0]
  handler: Parameters<Page['routeWebSocket']>[1]
}

/**
 * Custom implementation of the missing `page.unrouteWebSocket()` to remove
 * WebSocket route handlers from the page. Loosely inspired by `page.unroute()`.
 */
async function unrouteWebSocket(
  target: BrowserContext,
  url: InternalWebSocketRoute['url'],
  handler?: InternalWebSocketRoute['handler'],
): Promise<void> {
  if (
    !('_webSocketRoutes' in target && Array.isArray(target._webSocketRoutes))
  ) {
    return
  }

  for (let i = target._webSocketRoutes.length - 1; i >= 0; i--) {
    const route = target._webSocketRoutes[i] as InternalWebSocketRoute

    if (
      route.url === url &&
      (handler != null ? route.handler === handler : true)
    ) {
      target._webSocketRoutes.splice(i, 1)
    }
  }
}
