import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Real-browser validation of P3.05's criterion ("crisp on 2x displays; no
// distortion on resize"): DPR-aware canvas sizing is fundamentally a real
// `<canvas>` + `devicePixelRatio` + `ResizeObserver` behavior that jsdom
// doesn't implement faithfully, so (as in app-shell.responsive.test.ts) this
// drives an actual Chromium page instead.

const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let browser: Browser;
let server: PreviewServer;
let indexUrl: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(tmpdir(), "ballista-canvas-viewport-"));
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

async function readCanvasBox(page: import("playwright").Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="world-canvas"]')!;
    const rect = canvas.getBoundingClientRect();
    return {
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      dpr: window.devicePixelRatio,
    };
  });
}

describe("CanvasViewport DPR-aware sizing (P3.05)", () => {
  it("backing store is crisp on a 2x display: width/height match the CSS box scaled by devicePixelRatio", async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    try {
      await page.goto(indexUrl);
      await page.waitForSelector('[data-testid="world-canvas"]');
      // ResizeObserver's initial notification is asynchronous; wait for it
      // to have applied a nonzero backing-store size.
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="world-canvas"]');
        return !!canvas && canvas.width > 0;
      });

      const box = await readCanvasBox(page);
      expect(box.dpr).toBe(2);
      expect(box.backingWidth).toBe(Math.round(box.cssWidth * box.dpr));
      expect(box.backingHeight).toBe(Math.round(box.cssHeight * box.dpr));
    } finally {
      await page.close();
    }
  });

  it("resizing the viewport re-sizes the backing store proportionally, with no CSS-box distortion", async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    try {
      await page.goto(indexUrl);
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="world-canvas"]');
        return !!canvas && canvas.width > 0;
      });
      const before = await readCanvasBox(page);

      await page.setViewportSize({ width: 900, height: 650 });
      await page.waitForFunction(
        (prevBackingWidth) => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="world-canvas"]');
          return !!canvas && canvas.width !== prevBackingWidth;
        },
        before.backingWidth,
        { timeout: 10_000 },
      );

      const after = await readCanvasBox(page);

      // the CSS box actually changed (the container really resized)...
      expect(after.cssWidth).not.toBeCloseTo(before.cssWidth, 0);
      // ...and the backing store tracks it 1:1 at the same DPR, in both
      // dimensions equally -- i.e. no stretching/distortion.
      expect(after.backingWidth).toBe(Math.round(after.cssWidth * after.dpr));
      expect(after.backingHeight).toBe(Math.round(after.cssHeight * after.dpr));
    } finally {
      await page.close();
    }
  });
});
