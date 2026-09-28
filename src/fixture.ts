import { invariant } from 'outvariant'
import type {
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
  Route,
  WebSocketRoute,
} from '@playwright/test'
import { HttpResponse, isCommonAssetRequest } from 'msw'
import {
  defineNetwork,
  HttpNetworkFrame,
  NetworkSource,
  WebSocketNetworkFrame,
  type NetworkApi,
  type DefineNetworkOptions,
} from 'msw/experimental'
import {
  type WebSocketClientEventMap,
  type WebSocketData,
  type WebSocketServerEventMap,
  CancelableMessageEvent,
  CancelableCloseEvent,
  WebSocketClientHandle,
  WebSocketServerHandle,
} from '@mswjs/interceptors/WebSocket'

export interface NetworkFixtureOptions {
  context: BrowserContext
  handlers?: DefineNetworkOptions<any>['handlers']
  /**
   * Specifies how to react to a network frame (e.g. a request or
   * a WebSocket connection) that has no corresponding handler.
   * @default 'bypass'
   */
  onUnhandledFrame?: DefineNetworkOptions<any>['onUnhandledFrame']
  /**
   * Skip common asset requests (e.g. `*.html`, `*.css`, `*.js`, etc).
   * This improves performance for certain projects.
   * @default true
   *
   * @see https://mswjs.io/docs/api/is-common-asset-request
   */
  skipAssetRequests?: boolean
}

export type NetworkFixture = NetworkApi<[PlaywrightNetworkSource]>

export function defineNetworkFixture(
  options: NetworkFixtureOptions,
): NetworkFixture {
  return defineNetwork({
    sources: [
      new PlaywrightNetworkSource({
        context: options.context,
        skipAssetRequests: options.skipAssetRequests ?? true,
      }),
    ],
    handlers: options.handlers,
    onUnhandledFrame: options.onUnhandledFrame ?? 'bypass',
    context: {
      quiet: true,
    },
  })
}

/**
 * @note Use a match-all RegExp with an optional group as the predicate
 * for the `page.route()`/`page.unroute()` calls. Playwright treats given RegExp
 * as the handler ID, which allows us to remove only those handlers introduces by us
 * without carrying the reference to the handler function around.
 */
export const INTERNAL_MATCH_ALL_REG_EXP = /.+(__MSW_PLAYWRIGHT_PREDICATE__)?/

export interface PlaywrightNetworkSourceOptions {
  context: BrowserContext
  skipAssetRequests?: boolean
}

/**
 * A network source that emits the HTTP requests and WebSocket connections
 * routed through the given Playwright browser context.
 */
export class PlaywrightNetworkSource extends NetworkSource<
  PlaywrightHttpNetworkFrame | PlaywrightWebSocketNetworkFrame
> {
  #options: PlaywrightNetworkSourceOptions

  constructor(options: PlaywrightNetworkSourceOptions) {
    super()
    this.#options = options
  }

  public async enable(): Promise<void> {
    const { context } = this.#options

    await context.route(
      INTERNAL_MATCH_ALL_REG_EXP,
      this.#handleRequest.bind(this),
    )
    await context.routeWebSocket(
      INTERNAL_MATCH_ALL_REG_EXP,
      this.#handleWebSocketConnection.bind(this),
    )
  }

  public async disable(): Promise<void> {
    super.disable()

    const { context } = this.#options

    await context.unroute(INTERNAL_MATCH_ALL_REG_EXP)
    await unrouteWebSocket(context, INTERNAL_MATCH_ALL_REG_EXP)
  }

  async #handleRequest(
    route: Route,
    request: PlaywrightRequest,
  ): Promise<void> {
    const fetchRequest = new Request(request.url(), {
      method: request.method(),
      headers: new Headers(await request.allHeaders()),
      body: request.postDataBuffer() as ArrayBuffer | null,
    })

    /**
     * @note Skip common asset requests (default).
     * Playwright seems to experience performance degradation when routing all
     * requests through the matching logic below.
     * @see https://github.com/mswjs/playwright/issues/13
     */
    if (this.#options.skipAssetRequests && isCommonAssetRequest(fetchRequest)) {
      return safelyHandleRoute(() => route.fallback())
    }

    const referer = request.headers().referer
    const frame = new PlaywrightHttpNetworkFrame({
      request: fetchRequest,
      route,
      baseUrl: referer ? new URL(referer).origin : undefined,
    })

    await this.queue(frame)

    /**
     * @note Perform the request as-is if nothing has handled it.
     * This happens when the network gets disabled while the request is in-flight.
     */
    if (!frame.settled) {
      frame.passthrough()
    }
  }

  async #handleWebSocketConnection(route: WebSocketRoute): Promise<void> {
    const frame = new PlaywrightWebSocketNetworkFrame({
      route,
      baseUrl: this.#getBaseUrl(),
    })

    await this.queue(frame).catch((error) => {
      frame.errorWith(error)
    })
  }

  /**
   * Resolve the base URL for the WebSocket connections.
   * @note Playwright provides no means of knowing which page opened
   * the connection, so use the latest page in the browser context.
   */
  #getBaseUrl(): string | undefined {
    const pages = this.#options.context.pages()
    const lastPage = pages[pages.length - 1]

    if (lastPage == null) {
      return
    }

    return getPageUrl(lastPage)
  }
}

interface PlaywrightHttpNetworkFrameOptions {
  request: Request
  route: Route
  baseUrl?: string
}

class PlaywrightHttpNetworkFrame extends HttpNetworkFrame {
  #route: Route
  #baseUrl?: string
  #settled: boolean

  constructor(options: PlaywrightHttpNetworkFrameOptions) {
    super({ request: options.request })

    this.#route = options.route
    this.#baseUrl = options.baseUrl
    this.#settled = false
  }

  /**
   * Whether this frame has instructed Playwright on how to handle the route.
   */
  public get settled(): boolean {
    return this.#settled
  }

  public resolve(
    ...[handlers, onUnhandledFrame, resolutionContext]: Parameters<
      HttpNetworkFrame['resolve']
    >
  ): ReturnType<HttpNetworkFrame['resolve']> {
    return super.resolve(handlers, onUnhandledFrame, {
      ...resolutionContext,
      /**
       * @note Resolve relative handler URLs against the page
       * that has performed this request.
       */
      baseUrl: resolutionContext?.baseUrl ?? this.#baseUrl,
    })
  }

  public passthrough(): void {
    this.#settle(() => this.#route.fallback())
  }

  public respondWith(response?: Response): void {
    if (response == null) {
      return
    }

    // Network errors (e.g. `Response.error()`).
    if (response.status === 0) {
      this.#settle(() => this.#route.abort())
      return
    }

    this.#settle(async () => {
      return this.#route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: response.body
          ? Buffer.from(await response.arrayBuffer())
          : undefined,
      })
    })
  }

  public errorWith(reason?: unknown): void {
    if (reason instanceof Response) {
      return this.respondWith(reason)
    }

    /**
     * @note Library errors, like the "error" strategy for unhandled frames,
     * must fail the request.
     */
    if (reason instanceof Error && reason.name === 'InternalError') {
      this.#settle(() => this.#route.abort())
      return
    }

    const error =
      reason instanceof Error
        ? reason
        : new Error(reason?.toString() || 'Request failure')

    // Treat exceptions during the request handling as 500 responses
    // to alert the developer that there's a problem, same as in the browser.
    this.respondWith(
      HttpResponse.json(
        {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        {
          status: 500,
          statusText: 'Request Handler Error',
        },
      ),
    )
  }

  #settle(callback: () => Promise<void>): void {
    if (this.#settled) {
      return
    }

    this.#settled = true
    safelyHandleRoute(callback)
  }
}

interface PlaywrightWebSocketNetworkFrameOptions {
  route: WebSocketRoute
  baseUrl?: string
}

class PlaywrightWebSocketNetworkFrame extends WebSocketNetworkFrame {
  #route: WebSocketRoute
  #baseUrl?: string

  constructor(options: PlaywrightWebSocketNetworkFrameOptions) {
    super({
      connection: {
        client: new PlaywrightWebSocketClientConnection(options.route),
        server: new PlaywrightWebSocketServerConnection(options.route),
        info: {
          /**
           * @note Playwright does not expose the protocols requested by the client.
           */
          protocols: [],
        },
      },
    })

    this.#route = options.route
    this.#baseUrl = options.baseUrl
  }

  public resolve(
    ...[handlers, onUnhandledFrame, resolutionContext]: Parameters<
      WebSocketNetworkFrame['resolve']
    >
  ): ReturnType<WebSocketNetworkFrame['resolve']> {
    return super.resolve(handlers, onUnhandledFrame, {
      ...resolutionContext,
      baseUrl: resolutionContext?.baseUrl ?? this.#baseUrl,
    })
  }

  public passthrough(): void {
    this.data.connection.server.connect()
  }

  public errorWith(reason?: unknown): void {
    const { client } = this.data.connection

    if (client instanceof PlaywrightWebSocketClientConnection) {
      const errorEvent = new Event('error')

      Object.defineProperty(errorEvent, 'cause', {
        enumerable: true,
        configurable: false,
        value: reason,
      })

      client.socket.dispatchEvent(errorEvent)
    }

    this.#route.close({
      code: 1011,
      reason: reason instanceof Error ? reason.message : undefined,
    })
  }
}

class PlaywrightWebSocketClientConnection implements WebSocketClientHandle {
  public id: string
  public url: URL

  /**
   * @note Playwright does not expose the actual WebSocket reference.
   * Provide a plain event target instead so MSW can observe
   * the connection errors and closures.
   */
  public socket: EventTarget

  #forwardedEvents: Set<keyof WebSocketClientEventMap>

  constructor(protected readonly ws: WebSocketRoute) {
    this.id = crypto.randomUUID()
    this.url = new URL(ws.url())
    this.socket = new EventTarget()
    this.#forwardedEvents = new Set()
  }

  public send(data: WebSocketData): void {
    sendWebSocketData(this.ws, data)
  }

  public close(code?: number, reason?: string): void {
    this.ws.close({ code: code ?? 1000, reason })
  }

  public addEventListener<EventType extends keyof WebSocketClientEventMap>(
    type: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketClientEventMap[EventType],
    ) => void,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.#forwardEvent(type)
    this.socket.addEventListener(type, listener as EventListener, options)
  }

  public removeEventListener<EventType extends keyof WebSocketClientEventMap>(
    type: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketClientEventMap[EventType],
    ) => void,
    options?: EventListenerOptions | boolean,
  ): void {
    this.socket.removeEventListener(type, listener as EventListener, options)
  }

  /**
   * Forward the given Playwright route event to the event target.
   * @note Playwright supports a single listener per event, and adding it
   * disables the default forwarding of that event to the server.
   * Only forward the events somebody is listening to.
   */
  #forwardEvent(type: keyof WebSocketClientEventMap): void {
    if (this.#forwardedEvents.has(type)) {
      return
    }

    this.#forwardedEvents.add(type)

    switch (type) {
      case 'message': {
        this.ws.onMessage((data) => {
          this.socket.dispatchEvent(
            new CancelableMessageEvent('message', { data }),
          )
        })
        break
      }

      case 'close': {
        this.ws.onClose((code, reason) => {
          this.socket.dispatchEvent(
            new CancelableCloseEvent('close', { code, reason }),
          )
        })
        break
      }
    }
  }
}

class PlaywrightWebSocketServerConnection implements WebSocketServerHandle {
  #server?: WebSocketRoute
  #target: EventTarget
  #forwardedEvents: Set<keyof WebSocketServerEventMap>
  #bufferedData: Array<WebSocketData>

  constructor(protected readonly ws: WebSocketRoute) {
    this.#target = new EventTarget()
    this.#forwardedEvents = new Set()
    this.#bufferedData = []
  }

  public connect(): void {
    this.#server = this.ws.connectToServer()

    /**
     * @note Playwright does not support event buffering.
     * Forward the events that have been listened to
     * before `connect()` was called.
     */
    for (const type of this.#forwardedEvents) {
      this.#forwardEvent(this.#server, type)
    }

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

    sendWebSocketData(this.#server, data)
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
    if (!this.#forwardedEvents.has(type)) {
      this.#forwardedEvents.add(type)

      if (this.#server) {
        this.#forwardEvent(this.#server, type)
      }
    }

    this.#target.addEventListener(type, listener as EventListener, options)
  }

  public removeEventListener<EventType extends keyof WebSocketServerEventMap>(
    type: EventType,
    listener: (
      this: WebSocket,
      event: WebSocketServerEventMap[EventType],
    ) => void,
    options?: EventListenerOptions | boolean,
  ): void {
    this.#target.removeEventListener(type, listener as EventListener, options)
  }

  #forwardEvent(
    server: WebSocketRoute,
    type: keyof WebSocketServerEventMap,
  ): void {
    switch (type) {
      case 'message': {
        server.onMessage((data) => {
          this.#target.dispatchEvent(
            new CancelableMessageEvent('message', { data }),
          )
        })
        break
      }

      case 'close': {
        server.onClose((code, reason) => {
          this.#target.dispatchEvent(
            new CancelableCloseEvent('close', { code, reason }),
          )
        })
        break
      }
    }
  }
}

/**
 * Send the given WebSocket data via the Playwright route.
 * @note Playwright only supports sending strings and buffers.
 */
function sendWebSocketData(ws: WebSocketRoute, data: WebSocketData): void {
  if (typeof data === 'string') {
    ws.send(data)
    return
  }

  if (data instanceof Blob) {
    data.bytes().then((bytes) => {
      ws.send(Buffer.from(bytes))
    })
    return
  }

  if (data instanceof ArrayBuffer) {
    ws.send(Buffer.from(data))
    return
  }

  ws.send(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

function getPageUrl(page: Page): string | undefined {
  const url = page.url()

  if (url === 'about:blank') {
    return
  }

  // Encode/decode to preserve escape characters.
  return decodeURI(new URL(encodeURI(url)).origin)
}

async function safelyHandleRoute(callback: () => Promise<void>): Promise<void> {
  try {
    await callback()
  } catch (error) {
    /**
     * @note Ignore "Route is already handled!" errors.
     * Playwright has a bug where requests terminated due to navigation
     * cause your in-flight route handlers to throw. There's no means to
     * detect that scenario as both "route.handled" and "route._handlingPromise" are internal.
     * @see https://github.com/mswjs/playwright/issues/35
     */
    if (
      error instanceof Error &&
      /route is already handled/i.test(error.message)
    ) {
      return
    }

    throw error
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
  if (!(
    '_webSocketRoutes' in target && Array.isArray(target._webSocketRoutes)
  )) {
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
