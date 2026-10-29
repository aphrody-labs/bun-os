// SPDX-License-Identifier: MIT
/**
 * Headless browser page used by the zukan crawlers (`zukan/order.ts`,
 * `zukan/scripts/scrape-skills-pages.ts`).
 *
 * The production transport is Aphrody Web's Chrome DevTools Protocol client
 * (`@aphrody/agent-browser/cdp`). It is an optional peer dependency: it is
 * linked when this package is installed as a member of the Aphrody Bun
 * workspace, and absent from a standalone IECODE install. Hosts may also inject
 * another transport with `setWebCdpPageFactory`. Without a transport,
 * `connect()` fails explicitly instead of returning an empty page, so a crawl
 * never reports success on content it did not load.
 */

export interface NavigationResponse {
  ok?: boolean;
  status?: number;
  [key: string]: unknown;
}

export type WaitUntil = "load" | "domcontentloaded" | "commit" | "networkidle";

/** Minimal page contract shared with `@aphrody/agent-browser/cdp`. */
export interface CdpPageLike {
  goto(url: string, waitUntil?: WaitUntil): Promise<NavigationResponse>;
  evaluate<T>(script: string): Promise<T>;
  content(): Promise<string>;
  close(): Promise<void>;
}

export type CdpPageFactory = (endpoint?: string) => Promise<CdpPageLike>;

const APHRODY_CDP_MODULE = "@aphrody/agent-browser/cdp";

let pageFactory: CdpPageFactory | null = null;

/** Replace the CDP transport (tests, other hosts); `null` restores the default. */
export function setWebCdpPageFactory(factory: CdpPageFactory | null): void {
  pageFactory = factory;
}

async function defaultFactory(): Promise<CdpPageFactory> {
  let module: { WebCdpPage?: { connect(endpoint?: string): Promise<CdpPageLike> } };
  try {
    // Variable specifier: resolved at run time from the optional peer dependency.
    const specifier = APHRODY_CDP_MODULE;
    module = await import(specifier);
  } catch (error) {
    throw new Error(
      `No CDP transport: install @aphrody/inagle inside the Aphrody workspace (optional peer ${APHRODY_CDP_MODULE}) or call setWebCdpPageFactory().`,
      { cause: error },
    );
  }
  const page = module.WebCdpPage;
  if (!page || typeof page.connect !== "function") {
    throw new Error(`${APHRODY_CDP_MODULE} does not export WebCdpPage.connect`);
  }
  return endpoint => page.connect(endpoint);
}

export class WebCdpPage implements CdpPageLike {
  readonly #page: CdpPageLike;

  private constructor(page: CdpPageLike) {
    this.#page = page;
  }

  /** Connect to the configured CDP endpoint (`APHRODY_BROWSER_CDP_URL` by default). */
  static async connect(endpoint?: string): Promise<WebCdpPage> {
    const factory = pageFactory ?? (await defaultFactory());
    return new WebCdpPage(await factory(endpoint));
  }

  goto(url: string, waitUntil?: WaitUntil): Promise<NavigationResponse> {
    return this.#page.goto(url, waitUntil);
  }

  evaluate<T = unknown>(script: string): Promise<T> {
    return this.#page.evaluate<T>(script);
  }

  content(): Promise<string> {
    return this.#page.content();
  }

  close(): Promise<void> {
    return this.#page.close();
  }
}

export async function waitForSelector(page: WebCdpPage, selector: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const expression = `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  while (Date.now() < deadline) {
    if (await page.evaluate<boolean>(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Selector ${JSON.stringify(selector)} was not found within ${timeoutMs} ms`);
}
