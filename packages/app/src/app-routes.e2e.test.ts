import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, ConsoleMessage, Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROWSER_TARGETS, tryLaunch } from "./e2e-browser.js";
import { ROUTE_HASHES, type RouteHash } from "./routes.js";

/**
 * Route-level end-to-end coverage for every hash route the app serves
 * (P0.114).
 *
 * `app.e2e.test.ts` (P3.46) is a smoke suite for the *default* route only:
 * load, scrub, pin, share-URL round-trip. The other nine routes had no
 * browser coverage of any kind. Each has a `*-route.test.tsx` beside it,
 * but those mount one component under jsdom; none of them goes through
 * `main.tsx`'s `renderRoute` switch, so nothing asserted that a route hash
 * actually resolves to a rendered page in a browser -- a route could be
 * declared in `routes.ts`, wired into the switch, unit-tested, and still
 * be dead on arrival from a missing import or a module-scope throw.
 * `routes.test.ts` compares the two *tables* and, by construction, cannot
 * see that.
 *
 * The cases are generated from `ROUTE_HASHES` rather than a list written
 * out here, so a tenth route cannot be added without also being covered.
 * The mapping is the existing naming convention, asserted rather than
 * assumed: hash `#/solver-lab` renders `[data-testid="solver-lab-route"]`
 * and offers `[data-testid="solver-lab-back-link"]`.
 *
 * Server choice: this suite drives the **dev** server, on a fixed port in
 * the 3000-3010 range, where `app.e2e.test.ts` builds and previews. That
 * is deliberate and complementary -- the preview suite is about the
 * shipped bundle, this one is about the routes, and it fails in seconds
 * rather than after a full build. A route that works in one and not the
 * other is itself a finding worth having.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** First choice within the 3000-3010 band; vite walks upward if it is taken. */
const DEV_PORT = Number(process.env.BALLISTA_E2E_PORT ?? 3002);

/** `#/solver-lab` -> `solver-lab`. The suffix every route testid is built from. */
function routeSlug(hash: RouteHash): string {
  return hash.replace(/^#\//, "");
}

let server: ViteDevServer;
let appUrl: string;

beforeAll(async () => {
  server = await createServer({
    root: appRoot,
    configFile: path.join(appRoot, "vite.config.ts"),
    logLevel: "warn",
    server: { host: "127.0.0.1", port: DEV_PORT, strictPort: false },
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error("vite dev server did not report a local URL");
  appUrl = address;
  // Same 180 s budget and the same reasoning as `app.e2e.test.ts`'s hook
  // (P0.106): under the full parallel suite, a hook of this class has been
  // measured past 60 s while passing standalone minutes later. A dev server
  // starts far faster than a build, but it shares the machine.
}, 180_000);

afterAll(async () => {
  await server?.close();
});

/**
 * Opens a page that records `console.error` output and uncaught exceptions.
 * Both are assertion material, not diagnostics: a route that renders while
 * throwing in an effect looks fine to a selector-based test and is broken.
 */
async function openInstrumentedPage(browser: Browser): Promise<{
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
}> {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error" && !isFaviconNoise(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  return { page, consoleErrors, pageErrors };
}

/**
 * The browser asks for `/favicon.ico` on its own and `index.html` declares no
 * icon, so every page load logs one "Failed to load resource: 404". It is not
 * the app failing: the request is issued by the browser process, so it never
 * even appears in Playwright's request events, and no code path here can
 * prevent it. Filtered rather than asserted away, and filed as **P0.116** so
 * the missing favicon is a decision someone makes rather than a line of noise
 * a test learns to ignore. Deliberately narrow -- it matches the generic
 * resource-load message and nothing else, so a real failed import still fails
 * these tests.
 */
function isFaviconNoise(text: string): boolean {
  return /Failed to load resource: the server responded with a status of 404/.test(text);
}

async function readRunStatus(page: Page): Promise<{ points: number; duration: number }> {
  await page.waitForSelector('[data-testid="run-status"]');
  const text = await page.locator('[data-testid="run-status"]').textContent();
  const match = text?.match(/Trajectory: (\d+) points, T=([\d.]+)s/);
  if (!match) throw new Error(`run-status did not match the expected shape: "${text}"`);
  return { points: Number(match[1]), duration: Number(match[2]) };
}

/**
 * Per-test budget for every case below. The vitest default is 5 s and the
 * first two cases hit it: on a cold dev server the browser's first page load
 * pulls the whole module graph through vite's on-demand transform, measured
 * at just over 5 s here while every subsequent route came back in ~1.2 s off
 * the warm cache. Same reasoning as P0.106's hook budgets -- generous enough
 * that machine load alone cannot fail a case, tight enough that a genuine
 * hang still does.
 */
const BROWSER_TEST_TIMEOUT = 60_000;

for (const target of BROWSER_TARGETS) {
  describe(`Route suite (P0.114, ${target.name})`, { timeout: BROWSER_TEST_TIMEOUT }, () => {
    let browser: Browser | undefined;

    beforeAll(async () => {
      browser = await tryLaunch(target);
      if (!browser) {
        console.warn(
          `[app-routes.e2e.test] Skipping ${target.name}: no usable browser binary in this environment (expected in CI, which installs it explicitly).`,
        );
      }
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    it("serves the simulator at the bare URL, with the canvas and the control dock", async () => {
      if (!browser) return;
      const { page, consoleErrors, pageErrors } = await openInstrumentedPage(browser);
      try {
        await page.goto(appUrl);
        await page.waitForSelector('[data-testid="world-canvas"]');
        await expect(page.locator('[data-testid="control-dock"]').count()).resolves.toBe(1);
        const { points } = await readRunStatus(page);
        expect(points).toBeGreaterThan(0);
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
      } finally {
        await page.close();
      }
    });

    for (const hash of ROUTE_HASHES) {
      const slug = routeSlug(hash);

      it(`${hash} renders ${slug} cleanly, with one h1 and a way back`, async () => {
        if (!browser) return;
        const { page, consoleErrors, pageErrors } = await openInstrumentedPage(browser);
        try {
          await page.goto(`${appUrl}${hash}`);
          await page.waitForSelector(`[data-testid="${slug}-route"]`);

          // One h1 per document: these are separate pages as far as a screen
          // reader is concerned, and each of the nine declares its own.
          expect(await page.locator("h1").count()).toBe(1);
          const heading = (await page.locator("h1").textContent())?.trim() ?? "";
          expect(heading.length).toBeGreaterThan(0);

          await expect(page.locator(`[data-testid="${slug}-back-link"]`).count()).resolves.toBe(1);

          expect(pageErrors, `uncaught exceptions on ${hash}`).toEqual([]);
          expect(consoleErrors, `console errors on ${hash}`).toEqual([]);
        } finally {
          await page.close();
        }
      });

      it(`${hash}'s back link returns to the simulator`, async () => {
        if (!browser) return;
        const page = await browser.newPage();
        try {
          await page.goto(`${appUrl}${hash}`);
          await page.waitForSelector(`[data-testid="${slug}-back-link"]`);
          await page.locator(`[data-testid="${slug}-back-link"]`).click();

          // The switch's `default` branch renders `<App />`, so the canvas
          // coming back is the whole assertion: a back link that only changed
          // the hash without re-rendering would leave the route on screen.
          await page.waitForSelector('[data-testid="world-canvas"]');
          expect(new URL(page.url()).hash).toBe("#/");
        } finally {
          await page.close();
        }
      });
    }

    it("an unrecognised hash falls through to the simulator rather than a blank page", async () => {
      if (!browser) return;
      const page = await browser.newPage();
      try {
        await page.goto(`${appUrl}#/no-such-route`);
        await page.waitForSelector('[data-testid="world-canvas"]');
        const { points } = await readRunStatus(page);
        expect(points).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    });

    it("navigating away to a route and back keeps the committed scenario (module-scope session)", async () => {
      if (!browser) return;
      const page = await browser.newPage();
      try {
        await page.goto(appUrl);
        const before = await readRunStatus(page);

        await page.evaluate(() => {
          window.location.hash = "#/solver-lab";
        });
        await page.waitForSelector('[data-testid="solver-lab-route"]');
        await page.evaluate(() => {
          window.location.hash = "#/";
        });
        await page.waitForSelector('[data-testid="world-canvas"]');

        // `app.tsx` states this as a design property of the module-scope
        // session ("navigating to #/solver-lab and back doesn't lose the
        // committed scenario"). Nothing tested it; a per-mount session would
        // pass every unit test and quietly re-solve here.
        const after = await readRunStatus(page);
        expect(after).toEqual(before);
      } finally {
        await page.close();
      }
    });

    it("hashchange alone re-renders, with no reload, across every route in turn", async () => {
      if (!browser) return;
      const { page, consoleErrors, pageErrors } = await openInstrumentedPage(browser);
      try {
        await page.goto(appUrl);
        await page.waitForSelector('[data-testid="world-canvas"]');

        // A single document, walked through all ten routes: this is the path a
        // user actually takes, and it is the one that surfaces state a route
        // leaves behind (a stray listener, a worker never torn down, a store
        // mutated on unmount). Reloading between routes would hide all of it.
        await page.evaluate(() => {
          (window as unknown as { __ballistaLoads?: number }).__ballistaLoads = 1;
        });

        for (const hash of ROUTE_HASHES) {
          await page.evaluate((target) => {
            window.location.hash = target;
          }, hash);
          await page.waitForSelector(`[data-testid="${routeSlug(hash)}-route"]`);
        }

        await page.evaluate(() => {
          window.location.hash = "#/";
        });
        await page.waitForSelector('[data-testid="world-canvas"]');

        const survived = await page.evaluate(
          () => (window as unknown as { __ballistaLoads?: number }).__ballistaLoads,
        );
        expect(survived, "the page reloaded somewhere in the walk").toBe(1);
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
      } finally {
        await page.close();
      }
    });
  });
}
