import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, ConsoleMessage, Page, WebSocket } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_TARGETS, tryLaunch } from "./e2e-browser.js";
import { ROUTE_HASHES } from "./routes.js";

/**
 * Browser coverage of the app **under vite's dev server** (P0.126).
 *
 * Why this file exists. `app.e2e.test.ts` (P3.46) and
 * `app-routes.e2e.test.ts` (P0.114) both build and **preview**, so since
 * P0.125 no browser suite has driven the dev server at all. A defect that
 * only manifests under dev's on-demand transform -- a module the dep
 * optimizer resolves differently, a transform that only runs in dev, an
 * import that works served and not bundled -- would reach a developer's
 * browser with nothing red anywhere. P0.125 filed that gap as the cost side
 * of its own trade rather than absorbing it, and this is it being paid.
 *
 * WHY THIS DOES NOT REOPEN P0.125, which is the whole question this file
 * has to answer. P0.125's finding is that vite 5 injects its dev client at
 * module level, so the client's websocket **cannot be removed by
 * configuration**: `server.hmr = false` leaves one socket per page,
 * stripping `<script src="/@vite/client">` from the served HTML reduces
 * nothing, `prefreshEnabled: false` reduces nothing, and all three together
 * reduce nothing. Those four measurements stand, were not re-run here, and
 * are not contradicted -- every one of them is **server-side**. This suite
 * removes the socket from the **browser** side instead, which that finding
 * says nothing about, using two independent mechanisms:
 *
 *   1. `page.route` intercepts the request for `/@vite/client` whatever
 *      injects it and whatever URL it is imported from, and serves an inert
 *      module in its place. Configuration cannot stop vite asking for that
 *      module; the driver can decline to deliver it.
 *   2. `addInitScript` replaces `window.WebSocket` before any page script
 *      runs, with a recorder that notes the attempted URL and performs no
 *      handshake.
 *
 * (2) is what makes this safe on Firefox rather than merely likely to work.
 * P0.125's crash is an assert inside playwright-core's Firefox transport on
 * a `Page.webSocketOpened` event, and it is unhandled and uncatchable -- it
 * reddens CI with every test passing. With `window.WebSocket` replaced, no
 * handshake is ever attempted by page JavaScript, so that event cannot be
 * emitted. That reasoning is engine-independent: the socket was opened by
 * page JavaScript that no longer exists, not by anything Firefox does
 * differently. **Honest limit: this sandbox has no Firefox binary, so the
 * two-engine result is an argument from that mechanism plus a Chromium
 * measurement, not a local two-engine measurement.** CI installs Firefox
 * and is where it is confirmed.
 *
 * (1) is what keeps the page *clean* rather than merely socket-free. With
 * only (2), vite's client still loads and still tries to connect; the
 * recorder catches the attempt and the page renders, but the dev client is
 * live and retrying. With (1) as well it never asks.
 *
 * WHY THE STUB HAS THE EXPORTS IT HAS -- measured, not guessed. Three
 * cheaper shapes were tried on Chromium and all three fail: no intercept
 * reproduces the single socket (`ws://127.0.0.1:PORT/?token=...`);
 * fulfilling `/@vite/client` with `export {}` fails to render with an
 * uncaught "does not provide an export named 'createHotContext'", so that
 * export is load-bearing and the stub is required rather than defensive;
 * and `route.abort()` fails to render with `net::ERR_FAILED`, because
 * aborting a module-level import breaks the graph. Only the no-op stub
 * below renders with zero sockets and zero errors.
 *
 * WHY THE WEBSOCKET ASSERTIONS ARE NOT VACUOUS. An assertion that a list is
 * empty is worth only as much as the proof that something can put an entry
 * in it. Control, measured: with the recorder installed and the
 * `/@vite/client` stub **removed**, the recorder captures exactly one
 * attempt. So if a future vite injects its client from a URL
 * {@link VITE_CLIENT_ROUTE} does not match, this suite fails as a clean red
 * assertion on `wsAttempts` instead of returning P0.125's uncatchable
 * driver assert.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The dev client's module URL. Matched as a glob so it catches the request
 * however the importer spells it -- vite injects it as a root-absolute
 * `/@vite/client`, but a version that appended a query or moved it under a
 * base prefix would still be intercepted.
 */
const VITE_CLIENT_ROUTE = "**/@vite/client*";

/**
 * An inert stand-in for vite's dev client. Every export is a no-op, and the
 * hot context is a full no-op surface rather than an empty object because
 * the module-level code vite injects calls into it immediately.
 *
 * `createHotContext` is the one proven load-bearing: without it the page
 * dies on an uncaught "does not provide an export named" (see the header).
 * The rest are the client's other public entry points, present so that a
 * module reaching for one gets a no-op rather than a page error.
 */
const VITE_CLIENT_STUB = [
  "export function createHotContext() {",
  "  return {",
  "    accept() {}, acceptExports() {}, dispose() {}, prune() {},",
  "    invalidate() {}, on() {}, off() {}, send() {},",
  "  };",
  "}",
  "export function updateStyle() {}",
  "export function removeStyle() {}",
  "export function injectQuery(url) { return url; }",
  "",
].join("\n");

/**
 * Where the recorder parks attempted websocket URLs for the test to read.
 *
 * The literal is repeated inside {@link installWebSocketRecorder} rather
 * than referenced from it, and that is not an oversight: that function is
 * serialised into the page by playwright, so a reference to this constant
 * arrives in the browser as an undefined identifier. The first run of this
 * suite did exactly that and failed with `WS_ATTEMPTS_KEY is not defined`
 * surfacing as a page error -- caught only because every case asserts
 * `pageErrors` is empty. The shared type below is what keeps the two
 * spellings honest: changing one without the other stops compiling.
 */
const WS_ATTEMPTS_KEY = "__ballistaWebSocketAttempts";

interface WebSocketAttemptWindow {
  __ballistaWebSocketAttempts?: string[];
}

/**
 * Replaces `window.WebSocket` with a recorder that never connects.
 *
 * Runs as an init script, so it is installed before any page script --
 * including vite's dev client, which is the only thing in this app that
 * opens a socket at all (no package in this repository does). Serialised
 * into the page by playwright, so it must be self-contained: no imports, no
 * closure over anything in this module.
 */
function installWebSocketRecorder(): void {
  const attempts: string[] = [];
  // Literal, not WS_ATTEMPTS_KEY: see that constant's comment. This body
  // runs in the browser and can reference nothing from this module.
  (window as WebSocketAttemptWindow).__ballistaWebSocketAttempts = attempts;
  class RecordingWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly readyState = 3;
    readonly url: string;
    constructor(url: string | URL) {
      this.url = String(url);
      attempts.push(this.url);
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false;
    }
    send(): void {}
    close(): void {}
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = RecordingWebSocket;
}

let server: ViteDevServer | undefined;
let appUrl: string;

beforeAll(async () => {
  // No build: that is the point of a dev server, and it is why this suite
  // adds no `vite build` to CI where the other two each carry one. The
  // 180 s budget is the same class as P0.106's hook budgets -- generous
  // enough that machine load alone cannot fail it, tight enough that a
  // genuine hang still does.
  server = await createServer({
    root: appRoot,
    configFile: path.join(appRoot, "vite.config.ts"),
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error("vite dev server did not report a local URL");
  appUrl = address;
}, 180_000);

afterAll(async () => {
  await server?.close();
});

/**
 * Opens a page that is on the dev server but has no websocket: the recorder
 * installed, the dev client stubbed, and `console.error`/`pageerror`/
 * driver-level websocket events collected for assertion.
 *
 * The driver-level `websocket` list and the in-page `wsAttempts` list are
 * both asserted by every case and are not redundant. The first is what
 * P0.125's crash needs in order to fire; the second is what detects the
 * stub silently ceasing to match, which would otherwise show up only as
 * that crash.
 */
async function openDevPage(browser: Browser): Promise<{
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
  webSockets: string[];
  wsAttempts: () => Promise<string[]>;
}> {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const webSockets: string[] = [];
  await page.addInitScript(installWebSocketRecorder);
  await page.route(VITE_CLIENT_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: VITE_CLIENT_STUB,
    }),
  );
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  page.on("websocket", (socket: WebSocket) => webSockets.push(socket.url()));
  return {
    page,
    consoleErrors,
    pageErrors,
    webSockets,
    wsAttempts: async () =>
      page.evaluate(
        (key) =>
          (window as unknown as Record<string, string[] | undefined>)[key] ??
            // Distinguishable from "no attempts": the recorder not being
            // there at all would otherwise read as a clean pass.
            ["<recorder missing>"],
        WS_ATTEMPTS_KEY,
      ),
  };
}

async function readRunStatus(page: Page): Promise<{ points: number; duration: number }> {
  await page.waitForSelector('[data-testid="run-status"]');
  const text = await page.locator('[data-testid="run-status"]').textContent();
  const match = text?.match(/Trajectory: (\d+) points, T=([\d.]+)s/);
  if (!match) throw new Error(`run-status did not match the expected shape: "${text}"`);
  return { points: Number(match[1]), duration: Number(match[2]) };
}

/**
 * Same reasoning as `app-routes.e2e.test.ts`'s budget, and it applies more
 * here: on a cold dev server the first page load pulls the whole module
 * graph through the on-demand transform, measured there at just over 5 s
 * against a vitest default of 5 s.
 */
const BROWSER_TEST_TIMEOUT = 60_000;

/**
 * Engine-independent, so it runs once outside the browser loop and needs no
 * browser at all.
 *
 * This is what stops the suite silently degrading into a third preview
 * suite. Every case below would still pass against built assets; none of
 * them would be testing what this row is about. Asserting the dep
 * optimizer's rewrite pins the server to the dev path: in a built bundle
 * `/src/main.tsx` is not served at all.
 */
describe("Dev server (P0.126, transform path)", { timeout: BROWSER_TEST_TIMEOUT }, () => {
  it("serves the TSX entry transformed on demand, with bare specifiers rewritten", async () => {
    const response = await fetch(new URL("src/main.tsx", appUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);

    const body = await response.text();
    // Vite's dep optimizer rewrites `import ... from "preact/..."` to a
    // pre-bundled file under `/node_modules/.vite/deps/` with a version
    // query. That rewrite is the dev path's signature, and it is exactly
    // the machinery ("a module the optimizer resolves differently") this
    // row says has no browser coverage.
    expect(body).toMatch(/\/node_modules\/\.vite\/deps\//);
    // And it is really transformed, not the raw file echoed back.
    expect(body).not.toContain("<");
  });
});

for (const target of BROWSER_TARGETS) {
  describe(`Dev server (P0.126, ${target.name})`, { timeout: BROWSER_TEST_TIMEOUT }, () => {
    let browser: Browser | undefined;

    beforeAll(async () => {
      browser = await tryLaunch(target);
      if (!browser) {
        console.warn(
          `[app-dev-server.e2e.test] Skipping ${target.name}: no usable browser binary in this environment (expected in CI, which installs it explicitly).`,
        );
      }
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    it("renders and runs the default scenario under dev, with no websocket reaching the page", async () => {
      if (!browser) return;
      const { page, consoleErrors, pageErrors, webSockets, wsAttempts } =
        await openDevPage(browser);
      try {
        await page.goto(appUrl);
        await page.waitForSelector('[data-testid="world-canvas"]');
        await expect(page.locator('[data-testid="control-dock"]').count()).resolves.toBe(1);

        // A solve that produced points is the assertion that the dev
        // module graph is not merely present but working: the engine,
        // runtime and worker packages all came through the transform.
        const { points } = await readRunStatus(page);
        expect(points).toBeGreaterThan(0);

        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(webSockets, "P0.125: a websocket reached the driver under dev").toEqual([]);
        expect(
          await wsAttempts(),
          "either the /@vite/client stub stopped matching (see VITE_CLIENT_ROUTE) or the recorder did not install -- the value distinguishes them",
        ).toEqual([]);
      } finally {
        await page.close();
      }
    });

    it("resolves every route through dev's on-demand transform, in one document", async () => {
      if (!browser) return;
      const { page, consoleErrors, pageErrors, webSockets, wsAttempts } =
        await openDevPage(browser);
      try {
        await page.goto(appUrl);
        await page.waitForSelector('[data-testid="world-canvas"]');

        // Dev transforms on demand, so a route's modules are only compiled
        // once something imports them -- which means a dev-only breakage in
        // one route's graph is invisible until that route is visited. One
        // document walked through every route is what actually pulls all
        // twelve route graphs through the transform, and it is cheaper than
        // a page load each.
        for (const hash of ROUTE_HASHES) {
          await page.evaluate((target) => {
            window.location.hash = target;
          }, hash);
          const slug = hash.replace(/^#\//, "");
          await page.waitForSelector(`[data-testid="${slug}-route"]`);
        }

        await page.evaluate(() => {
          window.location.hash = "#/";
        });
        await page.waitForSelector('[data-testid="world-canvas"]');

        expect(pageErrors, "uncaught exception during the dev route walk").toEqual([]);
        expect(consoleErrors, "console error during the dev route walk").toEqual([]);
        expect(
          webSockets,
          "P0.125: the dev route walk reached the driver with a websocket",
        ).toEqual([]);
        expect(
          await wsAttempts(),
          "either the /@vite/client stub stopped matching (see VITE_CLIENT_ROUTE) or the recorder did not install -- the value distinguishes them",
        ).toEqual([]);
      } finally {
        await page.close();
      }
    });
  });
}
