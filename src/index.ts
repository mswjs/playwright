import type { Page, TestFixture } from '@playwright/test'
import {
  type LifeCycleEventsMap,
  SetupApi,
  RequestHandler,
  getResponse,
} from 'msw'

export function createWorkerFixture(
  initialHandlers: Array<RequestHandler> = [],
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

export class PlaywrightSetupApi extends SetupApi<LifeCycleEventsMap> {
  #page: Page

  constructor(args: { page: Page; initialHandlers: Array<RequestHandler> }) {
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
          body: response.body
            ? Buffer.from(await response.arrayBuffer())
            : undefined,
        })
        return
      }

      route.continue()
    })
  }

  public async stop() {
    super.dispose()
    await this.#page.unroute(/.+/)
  }
}
