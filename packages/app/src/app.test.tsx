// @vitest-environment jsdom
/**
 * App (default route) mount test. Mirrors `solver-lab-route.test.tsx`'s
 * jsdom-mount pattern: `App` now owns real state (a module-level
 * `SimulationSession` + pin store, P3.46) via hooks, so it needs a real
 * render cycle rather than the vnode-inspection style `app.test.tsx` used
 * before this file existed.
 */
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./app.js";

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

/** One event-loop turn, for state updates (preact re-renders, promise chains) that settle asynchronously. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Polls `check` once per event-loop turn until it returns a truthy value or `timeoutMs` elapses. */
async function waitFor<T>(check: () => T, timeoutMs = 2000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = check();
    if (result) return result as NonNullable<T>;
    if (Date.now() >= deadline) throw new Error("waitFor: timed out");
    await tick();
  }
}

function testid(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

describe("App", () => {
  it("is an AppShell (canvas/dock/drawer layout: see app-shell.test.tsx)", () => {
    const root = mount(<App />);
    expect(testid(root, "app-shell-canvas")).not.toBeNull();
    expect(testid(root, "app-shell-dock")).not.toBeNull();
    expect(testid(root, "app-shell-drawer")).not.toBeNull();
  });

  it("fills the analysis drawer with live range sensitivities for the committed scenario (P5.11)", () => {
    const root = mount(<App />);
    const drawer = testid(root, "app-shell-drawer")!;
    expect(drawer.querySelector('[data-testid="sensitivity-panel"]')).not.toBeNull();

    // The default scenario is the drag-free reference: the two aim channels
    // carry numbers, and the C_d channel is blank because no force reads it.
    // (`sensitivity-panel-logic.test.ts` is what pins the numbers themselves.)
    expect(testid(root, "sensitivity-value-theta")!.textContent).toMatch(/m\/rad$/);
    expect(testid(root, "sensitivity-value-speed")!.textContent).toMatch(/m\/\(m\/s\)$/);
    expect(testid(root, "sensitivity-value-cd")!.textContent).toBe("—");
  });

  it("runs the default scenario on load with no explicit Run button (draft/committed auto-integrates on commit, §5.3)", () => {
    const root = mount(<App />);
    const status = testid(root, "run-status")!;
    expect(status.textContent).toMatch(/^Trajectory: \d+ points, T=\d+\.\d{3}s$/);
  });

  it("scrubbing the playback slider updates the playback-time readout via pure lookup (§5.4)", async () => {
    const root = mount(<App />);
    const scrubber = testid(root, "playback-scrubber") as HTMLInputElement;
    const readout = testid(root, "playback-time-readout")!;

    expect(scrubber.disabled).toBe(false);
    const target = Number(scrubber.max) / 2;
    scrubber.value = String(target);
    scrubber.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => readout.textContent === `${target.toFixed(3)}s`);
  });

  it("pinning the committed trajectory renders it in the compare legend (P3.25)", async () => {
    const root = mount(<App />);
    expect(testid(root, "compare-legend")).toBeNull();

    const pinButton = testid(root, "pin-button") as HTMLButtonElement;
    expect(pinButton.disabled).toBe(false);
    pinButton.click();

    const legend = await waitFor(() => testid(root, "compare-legend"));
    expect(legend.querySelectorAll('[data-testid^="compare-legend-row-"]').length).toBe(1);
  });

  it("building a share URL round-trips through encode/decode as a #s= fragment (P3.32)", async () => {
    const root = mount(<App />);
    const shareButton = testid(root, "share-url-button") as HTMLButtonElement;
    shareButton.click();

    const output = await waitFor(() => testid(root, "share-url-output") as HTMLInputElement | null);
    expect(output.value).toMatch(/#s=[A-Za-z0-9_-]+$/);
  });
});
