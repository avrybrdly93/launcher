import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, firefox, type Browser, type BrowserType, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P3.46's own validation criterion: "suite green in CI on Chromium+Firefox"
 * -- the flow this smoke suite drives end to end (load, run default, scrub,
 * pin, share-URL) is real interactive state (`SimulationSession`,
 * `compareStore`, `scenario-share-url`) that jsdom can exercise at the DOM
 * level (see `simulator-controls.test.tsx`) but not through two genuinely
 * different browser engines, which is what this validation criterion asks
 * for. Mirrors `app-shell.responsive.test.ts`/`worker-pool.e2e.test.ts`'s
 * real-browser pattern (build once, `vite preview` once, drive it with a
 * real `Page`) and their plain-`expect`/imperative-polling style: this repo
 * drives raw `playwright` from Vitest rather than the `@playwright/test`
 * runner, so there is no auto-retrying `expect(locator).toXxx()` -- waits
 * are explicit (`waitForSelector`/`waitForFunction`), assertions are plain
 * `expect(...).toBe(...)` against values read out imperatively.
 *
 * Some sandboxed dev environments pre-stage only a Chromium build (see
 * `SANDBOX_CHROMIUM_PATH` below and its sibling comment in
 * `app-shell.responsive.test.ts`) and have no route to Playwright's browser
 * CDN to fetch Firefox on demand; CI (`.github/workflows/ci.yml`) always
 * installs both, so Firefox's group here is skipped (not failed) when its
 * binary isn't resolvable locally -- exactly like Chromium's sandbox-path
 * fallback is a "prefer if present", not a hard requirement.
 */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

interface BrowserTarget {
  readonly name: string;
  readonly type: BrowserType;
  readonly executablePath: string | undefined;
}

const CANDIDATE_TARGETS: readonly BrowserTarget[] = [
  {
    name: "chromium",
    type: chromium,
    executablePath: existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined,
  },
  { name: "firefox", type: firefox, executablePath: undefined },
];

function isAvailable(target: BrowserTarget): boolean {
  return existsSync(target.executablePath ?? target.type.executablePath());
}

const TARGETS = CANDIDATE_TARGETS.filter(isAvailable);
const SKIPPED = CANDIDATE_TARGETS.filter((t) => !isAvailable(t)).map((t) => t.name);
if (SKIPPED.length > 0) {
  console.warn(
    `simulator-smoke.e2e.test.ts: skipping [${SKIPPED.join(", ")}] -- binary not found locally; CI installs every target listed in .github/workflows/ci.yml's "Install Playwright browsers" step.`,
  );
}

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let server: PreviewServer;
let indexUrl: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-simulator-smoke-"));
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
  indexUrl = address;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const SUMMARY_SELECTOR = '[data-testid="sim-summary"]';
const READY_TIMEOUT = 10_000;

/** Waits for the boot commit's ready summary and returns its text content. */
async function waitForReadySummary(page: Page): Promise<string> {
  const handle = await page.waitForSelector(`${SUMMARY_SELECTOR}[data-sim-status="ready"]`, {
    timeout: READY_TIMEOUT,
  });
  const text = await handle.textContent();
  if (text === null) throw new Error("sim-summary had no text content");
  return text;
}

describe.each(TARGETS)("simulator smoke ($name)", ({ type, executablePath }) => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await type.launch(executablePath ? { executablePath } : {});
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("loads and runs the default scenario: a real trajectory is published and summarized", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(indexUrl);
      const summary = await waitForReadySummary(page);
      expect(summary).toMatch(/^steps=\d+ range=-?\d+\.\d+ duration=\d+\.\d+$/);
    } finally {
      await page.close();
    }
  });

  it("scrubbing moves the playback clock to the requested time", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(indexUrl);
      await waitForReadySummary(page);

      const scrub = page.locator('[data-testid="scrub-bar"]');
      expect(await scrub.isEnabled()).toBe(true);

      const duration = Number(await scrub.getAttribute("max"));
      expect(duration).toBeGreaterThan(0);
      const target = duration / 2;

      await scrub.evaluate((el: HTMLInputElement, value: number) => {
        el.value = String(value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, target);

      const time = await page.locator('[data-testid="scrub-time"]').textContent();
      expect(time).toBe(target.toFixed(6));
    } finally {
      await page.close();
    }
  });

  it("pinning the current trajectory adds a row to the compare legend", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(indexUrl);
      await waitForReadySummary(page);

      const pinButton = page.locator('[data-testid="pin-button"]');
      expect(await pinButton.isEnabled()).toBe(true);
      expect(await page.locator('[data-testid="compare-legend"]').count()).toBe(0);

      await pinButton.click();
      await page.waitForSelector('[data-testid="compare-legend"]', { timeout: 5_000 });

      const rows = await page.locator(".compare-legend-row").count();
      expect(rows).toBe(1);
    } finally {
      await page.close();
    }
  });

  it("share-URL: a link built from the running scenario reproduces the identical trajectory in a fresh page", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(indexUrl);
      const originalSummary = await waitForReadySummary(page);

      await page.locator('[data-testid="share-button"]').click();
      const shareOutput = page.locator('[data-testid="share-url-output"]');
      await shareOutput.waitFor({ state: "visible", timeout: 5_000 });
      const shareUrl = await shareOutput.inputValue();
      expect(shareUrl).toContain("#s=");

      const freshPage = await browser.newPage();
      try {
        await freshPage.goto(shareUrl);
        const freshSummary = await waitForReadySummary(freshPage);
        expect(freshSummary).toBe(originalSummary);
      } finally {
        await freshPage.close();
      }
    } finally {
      await page.close();
    }
  });
});
