import type { Page, TestFixture } from '@playwright/test'
import {
  SetupApi,
  RequestHandler,
  WebSocketHandler,
  type LifeCycleEventsMap,
  getResponse,
} from 'msw'

export function createWorkerFixture(
  initialHandlers: Array<RequestHandler | WebSocketHandler> = [],
  /** @todo `onUnhandledRequest`? */
): TestFixture<PlaywrightSetupApi, any> {
  return async ({ page }, use) => {
    const api = new PlaywrightSetupApi({
      page,
      initialHandlers,
    })

    await api.start()
    await use(api)
    await api.stop()
  }
}

class PlaywrightSetupApi extends SetupApi<LifeCycleEventsMap> {
  #page: Page

  constructor(args: {
    page: Page
    initialHandlers: Array<RequestHandler | WebSocketHandler>
  }) {
    super(...args.initialHandlers)
    this.#page = args.page
  }

  public async start() {
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
          body: response.body ? await response.arrayBuffer() : null,
        })
        return
      }

      route.continue()
    })

    // await this.#page.routeWebSocket(/.+/, async (ws) => {
    //   const client = new WebSocketClientConnection({})
    //   const server = new WebSocketServerConnection(client, {}, () => {})
    //   const connection: WebSocketConnectionData = {
    //     client,
    //     server,
    //     info: {
    //       protocols: [],
    //     },
    //   }

    //   const connectionEvent = new MessageEvent('connection', {
    //     data: connection,
    //   })

    //   const webSocketHandlers = this.handlersController
    //     .currentHandlers()
    //     .filter((handler) => {
    //       return handler instanceof WebSocketHandler
    //     })
    //     .filter((handler) => {
    //       return handler.predicate({
    //         event: connectionEvent,
    //         parsedResult: handler.parse({
    //           event: connectionEvent,
    //         }),
    //       })
    //     })

    //   if (webSocketHandlers.length > 0) {
    //     for (const webSocketHandler of webSocketHandlers) {
    //       /**
    //        * @fixme Expose a public `.run()` method that accepts a client.
    //        */
    //       webSocketHandler.handle({
    //         event: connectionEvent,
    //         parsedResult: webSocketHandler.parse({
    //           event: connectionEvent,
    //         }),
    //         connection,
    //       })
    //     }
    //     return
    //   }

    //   ws.connectToServer()
    // })
  }

  public async stop() {
    super.dispose()
    await this.#page.unroute(/.+/)
  }
}
