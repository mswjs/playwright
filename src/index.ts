import type { Page, TestFixture, WebSocketRoute } from '@playwright/test'
import {
  type LifeCycleEventsMap,
  SetupApi,
  RequestHandler,
  getResponse,
  WebSocketHandler,
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
    this.#page.routeWebSocket(/.+/, async (ws) => {
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
        handler.run({
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
    /**
     * @note Playwright type definitions are tailored to Node.js
     * while MSW describes all data types that can be sent over
     * the WebSocket protocol.
     */
    this.ws.send(data as any)
  }

  public close(code?: number, reason?: string): void {
    this.ws.close({ code, reason })
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

    if (typeof options === 'object' && options?.once) {
      console.warn(
        '@msw/playwright: WebSocketRoute from Playwright does not support "once" option',
      )
    }

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
          listener.call(
            target,
            new CloseEvent('close', { code, reason }) as any,
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

class PlaywrightWebSocketServerConnection
  implements WebSocketServerConnectionProtocol
{
  #server?: WebSocketRoute

  constructor(protected readonly ws: WebSocketRoute) {}

  public connect(): void {
    this.#server = this.ws.connectToServer()
  }

  public send(data: WebSocketData): void {
    if (!this.#server) {
      //
      return
    }

    this.#server.send(data as any)
  }

  public close(code?: number, reason?: string): void {
    if (!this.#server) {
      //
      return
    }

    this.#server.close({ code, reason })
  }

  public addEventListener<EventType extends keyof WebSocketServerEventMap>(
    event: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketServerEventMap[EventType],
    ) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (!this.#server) {
      return
    }

    if (typeof options === 'object' && options?.once) {
      console.warn(
        '@msw/playwright: WebSocketRoute from Playwright does not support "once" option',
      )
    }

    const target = {} as WebSocket
    switch (event) {
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
    event: EventType,
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
