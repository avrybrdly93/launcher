import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page, WebSocket } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_TARGETS, tryLaunch } from "./e2e-browser.js";

/**
 * Playwright end-to-end smoke suite (P3.46): load the real app shell, run
 * the default scenario, scrub, pin, and round-trip a share-URL, on
 * Chromium and Firefox. Mirrors `canvas-viewport.test.ts`/
 * `worker-pool.e2e.test.ts`'s "drive a real browser via the `playwright`
 * driver library from a vitest spec" pattern rather than introducing a
 * separate `@playwright/test` runner: it's the one already wired into
 * `pnpm test`/CI (`playwright install --with-deps chromium firefox` is
 * already a CI step -- see `.github/workflows/ci.yml`), so this suite rides
 * along with zero new CI wiring.
 *
 * Share-URLs are covered end-to-end exactly per §8.5: "encode -> fresh
 * session -> decode -> hash-compare" -- here as a fresh `page.goto()` of
 * the captured URL, comparing the re-run's trajectory point count and
 * duration against the original (a deterministic scenario+seed always
 * reproduces the same solve, so any mismatch is a real regression).
 *
 * Every case also asserts that its page opened **zero websockets**, which
 * is P0.117's half of P0.125's criterion and is not redundant with it.
 * P0.125 removed the websocket surface from `app-routes.e2e.test.ts`,
 * because that is the suite all eleven sightings of the playwright-core
 * Firefox assert (`assert` <- `FFPage._onWebSocketOpened`) were attributed
 * to. But this suite is the same shape -- the same `BROWSER_TARGETS` loop,
 * so the same Firefox target, against the same kind of vite server -- and
 * nothing here asserted the surface was absent. It happens to be absent
 * today because this suite has always previewed built assets rather than
 * served dev, and preview opens no sockets. "Happens to be absent" is the
 * state P0.125 was filed about: the defect it closed arrived when a suite
 * served dev, and a change that gave this one a dev server, or a
 * dependency that opened a socket of its own, would reopen the same
 * unhandled rejection here with P0.125's guard looking the other way. The
 * assertion is what makes that a red test instead of a red CI run with
 * every test passing.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let server: PreviewServer;
let appUrl: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-app-e2e-"));
  const configFile = path.join(appRoot, "vite.config.ts");
  await build({
    root: appRoot,
    configFile,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  server = await preview({
    root: appRoot,
    configFile,
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error("vite preview server did not report a local URL");
  appUrl = address;
  // P0.106: 180 s, not 60 s. This hook vite-builds the app and launches
  // Chromium; standalone it takes 22.9 s in this container, but under the
  // 254-file parallel suite the same class of hook has been measured at 48.6 s
  // (P4.38, canvas-viewport) and has crossed 60 s outright (app-shell.responsive,
  // 35th run) while passing standalone minutes later. 180 s is ~3.7x the slowest
  // standalone measurement on record, so a genuine hang still fails well before
  // vitest's own limits, while machine load alone no longer can. Ordinary unit
  // tests keep the 5 s default.
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/**
 * A page that records every websocket it opens.
 *
 * P0.117: the count is assertion material, not a diagnostic. See the header
 * -- a socket reaching a Firefox page in this suite is the precondition for
 * the playwright-core assert that reddens CI with every test passing, and it
 * is unreachable from application code, so no assertion inside a test can
 * catch it once it happens.
 */
async function openPage(browser: Browser): Promise<{ page: Page; webSockets: string[] }> {
  const page = await browser.newPage();
  const webSockets: string[] = [];
  page.on("websocket", (socket: WebSocket) => webSockets.push(socket.url()));
  return { page, webSockets };
}

async function readRunStatus(page: Page): Promise<{ points: number; duration: number }> {
  await page.waitForSelector('[data-testid="run-status"]');
  const text = await page.locator('[data-testid="run-status"]').textContent();
  const match = text?.match(/Trajectory: (\d+) points, T=([\d.]+)s/);
  if (!match) throw new Error(`run-status did not match the expected shape: "${text}"`);
  return { points: Number(match[1]), duration: Number(match[2]) };
}

for (const target of BROWSER_TARGETS) {
  describe(`App smoke suite (P3.46, ${target.name})`, () => {
    let browser: Browser | undefined;

    beforeAll(async () => {
      browser = await tryLaunch(target);
      if (!browser) {
        console.warn(
          `[app.e2e.test] Skipping ${target.name}: no usable browser binary in this environment (expected in CI, which installs it explicitly).`,
        );
      }
      // P0.106: 180 s, not 60 s. Launching a browser binary is the same
      // build-heavy class as the suite-level hook above, and shares its fate
      // under the parallel suite.
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    it("loads and runs the default scenario with no explicit Run button", async () => {
      if (!browser) return;
      const { page, webSockets } = await openPage(browser);
      try {
        await page.goto(appUrl);
        await page.waitForSelector('[data-testid="world-canvas"]');
        const { points } = await readRunStatus(page);
        expect(points).toBeGreaterThan(0);
        expect(webSockets, "P0.117: the page opened a websocket").toEqual([]);
      } finally {
        await page.close();
      }
    });

    it("scrubbing the playback slider updates the time readout via pure lookup", async () => {
      if (!browser) return;
      const { page, webSockets } = await openPage(browser);
      try {
        await page.goto(appUrl);
        const scrubber = page.locator('[data-testid="playback-scrubber"]');
        await page.waitForSelector('[data-testid="playback-scrubber"]:not([disabled])');
        const max = Number(await scrubber.getAttribute("max"));
        const target = max / 2;
        const expectedText = `${target.toFixed(3)}s`;

        // `<input type=range>` rejects Playwright's `.fill()` ("Malformed
        // value") since it isn't a text-editable control; set `.value`
        // directly and dispatch `input` ourselves instead, matching how a
        // real drag ultimately mutates the DOM.
        await scrubber.evaluate((el: HTMLInputElement, value: string) => {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }, String(target));

        await page.waitForFunction(
          (expected) =>
            document.querySelector('[data-testid="playback-time-readout"]')?.textContent ===
            expected,
          expectedText,
        );
        expect(webSockets, "P0.117: the page opened a websocket").toEqual([]);
      } finally {
        await page.close();
      }
    });

    it("pinning the committed trajectory renders it in the compare legend", async () => {
      if (!browser) return;
      const { page, webSockets } = await openPage(browser);
      try {
        await page.goto(appUrl);
        await readRunStatus(page);
        expect(await page.locator('[data-testid="compare-legend"]').count()).toBe(0);

        await page.locator('[data-testid="pin-button"]').click();

        await page.waitForSelector('[data-testid="compare-legend"]');
        const rows = page.locator('[data-testid^="compare-legend-row-"]');
        expect(await rows.count()).toBe(1);
        expect(webSockets, "P0.117: the page opened a websocket").toEqual([]);
      } finally {
        await page.close();
      }
    });

    it("a share URL round-trips through a fresh session to the same trajectory (§8.5)", async () => {
      if (!browser) return;
      const { page: originalPage, webSockets: originalSockets } = await openPage(browser);
      let sharedUrl: string;
      let original: { points: number; duration: number };
      try {
        await originalPage.goto(appUrl);
        original = await readRunStatus(originalPage);

        await originalPage.locator('[data-testid="share-url-button"]').click();
        await originalPage.waitForSelector('[data-testid="share-url-output"]');
        sharedUrl = await originalPage.locator('[data-testid="share-url-output"]').inputValue();
        expect(sharedUrl).toMatch(/#s=[A-Za-z0-9_-]+$/);
        expect(originalSockets, "P0.117: the page opened a websocket").toEqual([]);
      } finally {
        await originalPage.close();
      }

      const { page: freshPage, webSockets: freshSockets } = await openPage(browser);
      try {
        await freshPage.goto(sharedUrl);
        const reloaded = await readRunStatus(freshPage);
        expect(reloaded).toEqual(original);
        expect(freshSockets, "P0.117: the fresh session opened a websocket").toEqual([]);
      } finally {
        await freshPage.close();
      }
    });
  });
}
