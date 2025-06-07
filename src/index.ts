import { invariant } from 'outvariant'
import type { Page, TestFixture, WebSocketRoute } from '@playwright/test'
import {
  type LifeCycleEventsMap,
  SetupApi,
  RequestHandler,
  WebSocketHandler,
  getResponse,
} from 'msw'
import {
  type WebSocketClientEventMap,
  type WebSocketData,
  type WebSocketServerEventMap,
  WebSocketClientConnectionProtocol,
  WebSocketServerConnectionProtocol,
} from '@mswjs/interceptors/WebSocket'

export interface CreateWorkerFixtureArgs {
  initialHandlers: Array<RequestHandler | WebSocketHandler>
}

export function createWorkerFixture(
  args?: CreateWorkerFixtureArgs,
  /** @todo `onUnhandledRequest`? */
): TestFixture<WorkerFixture, any> {
  return async ({ page }, use) => {
    const worker = new WorkerFixture({
      page,
      initialHandlers: args?.initialHandlers || [],
    })

    await worker.start()
    await use(worker)
    await worker.stop()
  }
}

export class WorkerFixture extends SetupApi<LifeCycleEventsMap> {
  #page: Page

  constructor(args: {
    page: Page
    initialHandlers: Array<RequestHandler | WebSocketHandler>
  }) {
    super(...args.initialHandlers)
    this.#page = args.page
  }

  public async start() {
    // Handle HTTP requests.
    await this.#page.route(/.+/, async (route, request) => {
      const fetchRequest = new Request(request.url(), {
        method: request.method(),
        headers: new Headers(await request.allHeaders()),
        body: request.postDataBuffer(),
      })

      const response = await getResponse(
        this.handlersController.currentHandlers().filter((handler) => {
          return handler instanceof RequestHandler
        }),
        fetchRequest,
      )

      if (response) {
        route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: response.body
            ? Buffer.from(await response.arrayBuffer())
            : undefined,
        })
        return
      }

      route.continue()
    })

    // Handle WebSocket connections.
    await this.#page.routeWebSocket(/.+/, async (ws) => {
      const allWebSocketHandlers = this.handlersController
        .currentHandlers()
        .filter((handler) => {
          return handler instanceof WebSocketHandler
        })

      if (allWebSocketHandlers.length === 0) {
        ws.connectToServer()
        return
      }

      const client = new PlaywrightWebSocketClientConnection(ws)
      const server = new PlaywrightWebSocketServerConnection(ws)

      for (const handler of allWebSocketHandlers) {
        await handler.run({
          client,
          server,
          info: { protocols: [] },
        })
      }
    })
  }

  public async stop() {
    super.dispose()
    await this.#page.unroute(/.+/)
  }
}

class PlaywrightWebSocketClientConnection
  implements WebSocketClientConnectionProtocol
{
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
            new MessageEvent('message', {
              data,
            }) as any,
          )
        })
        break
      }

      case 'close': {
        this.ws.onClose((code, reason) => {
          /**
           * @note This is run in Node.js, where CloseEvent doesn't exist.
           */
          const closeEvent = new Event('close')
          Object.defineProperties(closeEvent, {
            code: { value: code, writable: false, enumerable: true },
            reason: { value: reason, writable: false, enumerable: true },
            wasClean: {
              value: code === 1000,
              writable: false,
              enumerable: true,
            },
          })
          listener.call(target, closeEvent as any)
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

class PlaywrightWebSocketServerConnection
  implements WebSocketServerConnectionProtocol
{
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
          listener.call(target, new MessageEvent('message', { data }) as any)
        })
        break
      }

      case 'close': {
        this.#server.onClose((code, reason) => {
          listener.call(
            target,
            new CloseEvent('close', { code, reason }) as any,
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
