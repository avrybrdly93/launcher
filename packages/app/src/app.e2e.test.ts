import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, type Browser, type BrowserType, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
 */

const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface BrowserTarget {
  readonly name: string;
  readonly type: BrowserType;
}

const BROWSER_TARGETS: readonly BrowserTarget[] = [
  { name: "chromium", type: chromium },
  { name: "firefox", type: firefox },
];

/**
 * This sandbox pre-provisions only a (version-mismatched) Chromium binary
 * under a fixed symlink -- see the identical pattern in
 * `canvas-viewport.test.ts`/`worker-pool.e2e.test.ts` -- and has no Firefox
 * binary anywhere. Real CI installs both via `playwright install
 * --with-deps chromium firefox` into Playwright's own default cache, where
 * `browserType.launch()` resolves them with no override needed at all (the
 * override below never applies there, since `SANDBOX_CHROMIUM_PATH` doesn't
 * exist on a CI runner). `resolveExecutablePath` asks Playwright itself
 * where it would look, so the same "does a binary actually exist here"
 * check works for both browsers without hardcoding a second sandbox path
 * that doesn't exist yet.
 */
function resolveExecutablePath(target: BrowserTarget): string | undefined {
  if (target.name === "chromium" && existsSync(SANDBOX_CHROMIUM_PATH)) {
    return SANDBOX_CHROMIUM_PATH;
  }
  try {
    const path = target.type.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

async function tryLaunch(target: BrowserTarget): Promise<Browser | undefined> {
  const executablePath = resolveExecutablePath(target);
  if (executablePath === undefined && target.name !== "chromium") {
    // No SANDBOX_* override exists for this browser and Playwright can't
    // find an installed binary either -- this environment genuinely
    // doesn't have it (see module doc). Skip rather than fail: CI, which
    // installs both browsers itself, still runs this suite for real. A
    // `launch()` failure past this point (a binary *was* found) is a real
    // problem and is deliberately left to throw/fail the suite, not
    // swallowed -- silently downgrading a genuine CI launch failure to a
    // skip would defeat this task's "green in CI on Chromium+Firefox"
    // validation criterion.
    return undefined;
  }
  return target.type.launch(executablePath ? { executablePath } : {});
}

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
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

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
    }, 60_000);

    afterAll(async () => {
      await browser?.close();
    });

    it("loads and runs the default scenario with no explicit Run button", async () => {
      if (!browser) return;
      const page = await browser.newPage();
      try {
        await page.goto(appUrl);
        await page.waitForSelector('[data-testid="world-canvas"]');
        const { points } = await readRunStatus(page);
        expect(points).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    });

    it("scrubbing the playback slider updates the time readout via pure lookup", async () => {
      if (!browser) return;
      const page = await browser.newPage();
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
      } finally {
        await page.close();
      }
    });

    it("pinning the committed trajectory renders it in the compare legend", async () => {
      if (!browser) return;
      const page = await browser.newPage();
      try {
        await page.goto(appUrl);
        await readRunStatus(page);
        expect(await page.locator('[data-testid="compare-legend"]').count()).toBe(0);

        await page.locator('[data-testid="pin-button"]').click();

        await page.waitForSelector('[data-testid="compare-legend"]');
        const rows = page.locator('[data-testid^="compare-legend-row-"]');
        expect(await rows.count()).toBe(1);
      } finally {
        await page.close();
      }
    });

    it("a share URL round-trips through a fresh session to the same trajectory (§8.5)", async () => {
      if (!browser) return;
      const originalPage = await browser.newPage();
      let sharedUrl: string;
      let original: { points: number; duration: number };
      try {
        await originalPage.goto(appUrl);
        original = await readRunStatus(originalPage);

        await originalPage.locator('[data-testid="share-url-button"]').click();
        await originalPage.waitForSelector('[data-testid="share-url-output"]');
        sharedUrl = await originalPage.locator('[data-testid="share-url-output"]').inputValue();
        expect(sharedUrl).toMatch(/#s=[A-Za-z0-9_-]+$/);
      } finally {
        await originalPage.close();
      }

      const freshPage = await browser.newPage();
      try {
        await freshPage.goto(sharedUrl);
        const reloaded = await readRunStatus(freshPage);
        expect(reloaded).toEqual(original);
      } finally {
        await freshPage.close();
      }
    });
  });
}
