import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Some sandboxed dev environments pre-stage a Chromium build under a fixed
// path rather than one matching this pinned Playwright version's expected
// revision; prefer it when present instead of Playwright's own (version-
// matched, auto-downloaded) resolution used everywhere else, e.g. CI.
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

// Real-browser validation of P3.01's criterion ("responsive at
// 1280/1920/mobile; no scroll traps"): jsdom does not run layout, so the
// only faithful check is an actual rendered page at real viewport sizes.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let browser: Browser;
let server: PreviewServer;
let indexUrl: string;
let outDir: string;

beforeAll(async () => {
  // `type="module"` script tags don't execute when loaded from a `file://`
  // URL (blocked by the module loader's same-origin fetch restriction), so
  // the build is served over a real (loopback) HTTP origin instead.
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-app-shell-"));
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
  browser = await chromium.launch(
    existsSync(SANDBOX_CHROMIUM_PATH) ? { executablePath: SANDBOX_CHROMIUM_PATH } : {},
  );
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const VIEWPORTS = [
  { name: "1280 desktop", width: 1280, height: 800, desktop: true },
  { name: "1920 desktop", width: 1920, height: 1080, desktop: true },
  { name: "mobile", width: 375, height: 812, desktop: false },
];

describe.each(VIEWPORTS)("app shell at $name ($width x $height)", ({ width, height, desktop }) => {
  it("has no horizontal scroll trap (document does not overflow the viewport width)", async () => {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto(indexUrl);
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowX).toBeLessThanOrEqual(0);
    } finally {
      await page.close();
    }
  });

  it("renders the canvas, control dock, and analysis drawer regions with nonzero area", async () => {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto(indexUrl);
      for (const testId of ["app-shell-canvas", "app-shell-dock", "app-shell-drawer"]) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box, `${testId} should be visible`).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
      }
    } finally {
      await page.close();
    }
  });

  if (desktop) {
    it("places the control dock to the right of the canvas", async () => {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.goto(indexUrl);
        const canvas = (await page.getByTestId("app-shell-canvas").boundingBox())!;
        const dock = (await page.getByTestId("app-shell-dock").boundingBox())!;
        expect(dock.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
      } finally {
        await page.close();
      }
    });

    it("places the analysis drawer along the bottom, spanning under canvas and dock", async () => {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.goto(indexUrl);
        const canvas = (await page.getByTestId("app-shell-canvas").boundingBox())!;
        const dock = (await page.getByTestId("app-shell-dock").boundingBox())!;
        const drawer = (await page.getByTestId("app-shell-drawer").boundingBox())!;
        expect(drawer.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
        expect(drawer.y).toBeGreaterThanOrEqual(dock.y + dock.height - 1);
      } finally {
        await page.close();
      }
    });
  } else {
    it("stacks regions vertically and keeps every region reachable by scrolling the page (single scroll surface)", async () => {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.goto(indexUrl);
        const canvas = (await page.getByTestId("app-shell-canvas").boundingBox())!;
        const dock = (await page.getByTestId("app-shell-dock").boundingBox())!;
        const drawerBeforeScroll = (await page.getByTestId("app-shell-drawer").boundingBox())!;
        expect(dock.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
        expect(drawerBeforeScroll.y).toBeGreaterThanOrEqual(dock.y + dock.height - 1);

        // The drawer starts below the fold on a short mobile viewport; if the
        // page itself doesn't scroll there (e.g. a nested region silently ate
        // the scroll), it would never become reachable -- that is the trap.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const drawerAfterScroll = (await page.getByTestId("app-shell-drawer").boundingBox())!;
        expect(drawerAfterScroll.y).toBeLessThan(height);
        expect(drawerAfterScroll.y + drawerAfterScroll.height).toBeGreaterThan(0);
      } finally {
        await page.close();
      }
    });
  }
});
