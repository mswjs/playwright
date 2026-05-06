import type { BrowserContext, Page, Route } from '@playwright/test'

export async function convertToRequest(route: Route): Promise<Request> {
  const request = route.request()
  return new Request(request.url(), {
    method: request.method(),
    headers: new Headers(await request.allHeaders()),
    body: request.postDataBuffer() as null | ArrayBuffer,
  })
}

export function inferRouteBaseUrl(route: Route): string | undefined {
  const request = route.request()
  let url = request.headers().referer
  if (!url && request.isNavigationRequest()) {
    url = request.url()
  } else if (!url && request.serviceWorker() === null) {
    url = request.frame().url()
  }

  if (!url || url === 'about:blank') {
    return undefined
  }
  return new URL(url).origin
}

export function inferPageBaseUrl(
  target: BrowserContext | Page,
): string | undefined {
  const url = 'url' in target ? target.url() : target.pages().at(-1)?.url()

  if (!url || url === 'about:blank') {
    return undefined
  }
  return decodeURI(new URL(encodeURI(url)).origin)
}

export async function fulfillResponse(
  route: Route,
  response: Response,
): Promise<void> {
  try {
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: response.body
        ? Buffer.from(await response.arrayBuffer())
        : undefined,
    })
  } catch (error) {
    ignoreRouteHandledError(error)
  }
}

export async function abortRequest(route: Route): Promise<void> {
  try {
    await route.abort()
  } catch (error) {
    ignoreRouteHandledError(error)
  }
}

export async function passthroughRequest(route: Route): Promise<void> {
  try {
    await route.fallback()
  } catch (error) {
    ignoreRouteHandledError(error)
  }
}

/**
 * @note Ignore "Route is already handled!" errors.
 * Playwright has a bug where requests terminated due to navigation
 * cause your in-flight route handlers to throw. There's no means to
 * detect that scenario as both "route.handled" and "route._handlingPromise" are internal.
 * @see https://github.com/mswjs/playwright/issues/35
 */
function ignoreRouteHandledError(error: unknown): void {
  if (
    error instanceof Error &&
    /route is already handled/i.test(error.message)
  ) {
    return
  }

  throw error
}

/** Callback for unmounting a configured route. */
export type UnrouteFn = () => Promise<void> | void

export async function registerRouteHandler(
  target: BrowserContext | Page,
  url: Parameters<Page['route']>[0],
  handler: Parameters<Page['route']>[1],
  options?: Parameters<Page['route']>[2],
): Promise<UnrouteFn> {
  const result = await target.route(url, handler, options)
  /** @note Earlier version (pre Playwright v1.59) did return `void`. */
  if (result) return result.dispose.bind(result)

  return () => target.unroute(url, handler)
}

export async function registerWebSocketRouteHandler(
  target: BrowserContext | Page,
  url: Parameters<BrowserContext['routeWebSocket']>[0],
  handler: Parameters<BrowserContext['routeWebSocket']>[1],
): Promise<UnrouteFn> {
  await target.routeWebSocket(url, handler)
  return () => unrouteWebSocket(target, url, handler)
}

interface InternalWebSocketRoute {
  url: Parameters<BrowserContext['routeWebSocket']>[0]
  handler: Parameters<BrowserContext['routeWebSocket']>[1]
}

/**
 * Custom implementation of the missing `page.unrouteWebSocket()` to remove
 * WebSocket route handlers from the page. Loosely inspired by `page.unroute()`.
 */
function unrouteWebSocket(
  target: BrowserContext | Page,
  url: InternalWebSocketRoute['url'],
  handler?: InternalWebSocketRoute['handler'],
): void {
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
