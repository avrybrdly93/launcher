// @vitest-environment jsdom
/**
 * SimulatorControls mount test (P3.46 wiring). Mirrors
 * `solver-lab-route.test.tsx`'s jsdom-mount pattern: hooks need a real
 * render cycle. The real-browser flows this backs (actual canvas, a real
 * Chromium tab boundary for the share-URL round trip) are covered by
 * `simulator-smoke.e2e.test.ts` instead -- this file exercises the DOM/state
 * wiring itself: default-scenario boot, scrub, pin, and the share-URL
 * encode/decode round trip against a real (jsdom) `CompressionStream`.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { SimulatorControls } from "./simulator-controls.js";

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
  window.history.replaceState(null, "", "/");
});

/**
 * Polls `check` until it returns `true` (or `timeoutMs` elapses), rather
 * than guessing a fixed number of microtask/macrotask turns for the boot
 * effect's async IIFE and Preact's own effect scheduling to settle.
 */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Waits for the boot commit to publish a result and the ready view to render. */
async function waitForReady(root: HTMLDivElement): Promise<void> {
  await waitFor(() => root.querySelector('[data-testid="sim-summary"]') !== null);
}

describe("SimulatorControls (P3.46)", () => {
  it("shows a loading state before the boot commit resolves", () => {
    const root = mount(<SimulatorControls />);
    expect(root.querySelector('[data-testid="sim-status"]')).not.toBeNull();
  });

  it("runs the default scenario on load: a real trajectory is published and summarized", async () => {
    const root = mount(<SimulatorControls />);
    await waitForReady(root);

    const summary = root.querySelector('[data-testid="sim-summary"]')!;
    expect(summary.getAttribute("data-sim-status")).toBe("ready");
    expect(summary.textContent).toMatch(/^steps=\d+ range=-?\d+\.\d+ duration=\d+\.\d+$/);
  });

  it("scrubbing moves the playback clock to the requested time (pure lookup, no re-solve)", async () => {
    const root = mount(<SimulatorControls />);
    await waitForReady(root);

    const scrub = root.querySelector('[data-testid="scrub-bar"]') as HTMLInputElement;
    expect(scrub.disabled).toBe(false);
    const duration = Number(scrub.max);
    expect(duration).toBeGreaterThan(0);

    const target = duration / 2;
    scrub.value = String(target);
    scrub.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => {
      const time = root.querySelector('[data-testid="scrub-time"]')!;
      return Math.abs(Number(time.textContent) - target) < 1e-6;
    });
  });

  it("pinning the current trajectory adds a row to the compare legend", async () => {
    const root = mount(<SimulatorControls />);
    await waitForReady(root);

    expect(root.querySelector('[data-testid="compare-legend"]')).toBeNull();

    const pinButton = root.querySelector('[data-testid="pin-button"]') as HTMLButtonElement;
    expect(pinButton.disabled).toBe(false);
    pinButton.click();

    await waitFor(() => root.querySelector('[data-testid="compare-legend"]') !== null);
    const legend = root.querySelector('[data-testid="compare-legend"]')!;
    expect(legend.querySelectorAll(".compare-legend-row")).toHaveLength(1);
  });

  it("share round trip: a share URL built from the committed scenario reproduces the identical trajectory on a fresh mount", async () => {
    const first = mount(<SimulatorControls />);
    await waitForReady(first);
    const firstSummary = first.querySelector('[data-testid="sim-summary"]')!.textContent;

    const shareButton = first.querySelector('[data-testid="share-button"]') as HTMLButtonElement;
    shareButton.click();

    await waitFor(() => first.querySelector('[data-testid="share-url-output"]') !== null);
    const shareOutput = first.querySelector('[data-testid="share-url-output"]') as HTMLInputElement;
    expect(window.location.hash.startsWith("#s=")).toBe(true);
    expect(shareOutput.value).toBe(window.location.href);

    // A fresh mount (simulating a new tab/session opened at the share URL)
    // reads the same `window.location.href` on boot -- exactly what
    // `parseShareUrl` decodes from in the real app.
    render(null, first);
    first.remove();
    const second = mount(<SimulatorControls />);
    await waitForReady(second);

    const secondSummary = second.querySelector('[data-testid="sim-summary"]')!.textContent;
    expect(secondSummary).toBe(firstSummary);
  });
});
