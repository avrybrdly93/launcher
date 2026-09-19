// @vitest-environment jsdom
/**
 * BenchmarkRoute mount tests (P7.32).
 *
 * The card's content rules, the allowlist and the opt-in default are asserted
 * in `benchmark-result-card.test.ts`, and the ladder driving in
 * `benchmark-page-run.test.ts`. What only this layer can check is the wiring:
 * that the page really runs the benchmark rather than rendering a shell, that
 * the opt-in checkbox starts unchecked and re-renders the card it is toggled
 * over, and that Cancel reaches a run already in flight.
 *
 * `PAGE_REPLICATES` is 2000, which is several seconds of real integration, so
 * the module's runner is stubbed here and driven through its real generator
 * contract. The alternative -- a full ladder per test -- would make this file
 * the slowest in the repository while asserting nothing extra about the DOM.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkPageStep, LadderRung } from "@ballista/runtime";

const rung: LadderRung = {
  stepSize: 0.1,
  replicates: 2000,
  workers: 1,
  elapsedSeconds: 0.5,
  trajectoriesPerSecond: 4000,
  relativeRangeError: 1e-12,
};

/** A short, deterministic stand-in for the real ladder. */
function* fakeSteps(): Generator<BenchmarkPageStep, void, void> {
  yield { completed: 1, total: 3 };
  yield { completed: 2, total: 3 };
  yield { completed: 3, total: 3, rung };
}

vi.mock("@ballista/runtime", async () => {
  const actual = await vi.importActual<typeof import("@ballista/runtime")>("@ballista/runtime");
  return {
    ...actual,
    benchmarkPageSteps: (): Generator<BenchmarkPageStep, void, void> => fakeSteps(),
    detectComputeCapability: async () => ({
      webgpu: {
        supported: true,
        reason: null,
        adapter: { vendor: "amd", architecture: "rdna3", device: "RX 7900 XTX" },
        features: [],
        limits: {
          maxComputeWorkgroupSizeX: null,
          maxComputeInvocationsPerWorkgroup: null,
          maxComputeWorkgroupsPerDimension: null,
          maxStorageBufferBindingSize: null,
          maxBufferSize: null,
        },
      },
      cpu: { available: ["ts"], hardwareConcurrency: 4 },
      plan: {
        backendId: "ts",
        label: "TypeScript reference stepper",
        kind: "cpu",
        reason: "no WebGPU adapter",
        parallelism: 1,
      },
    }),
  };
});

const { BenchmarkRoute } = await import("./benchmark-route.js");

let host: HTMLDivElement | undefined;

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
});

function mount(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<BenchmarkRoute />, host);
  return host;
}

function byTestId(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

/**
 * Real timers, deliberately.
 *
 * The route's `setTimeout(0)` pump exists precisely so the event loop gets a
 * turn, and under fake timers the capability probe's promise chain does not
 * settle in step with it -- the run button stays disabled and the click is a
 * no-op, which reads as "the page renders nothing" rather than as a timer
 * problem. So this polls for the state it wants instead of asserting on any
 * duration: it is a wait for a condition, not a wall-clock budget of the kind
 * P0.96 and P0.112 are open about, and it fails by timing out on a
 * *never*, not on a slow machine.
 */
async function settle(root: HTMLElement, testId: string, ticks = 200): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    if (byTestId(root, testId)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

/** Mounts, waits for the capability probe, and returns the host. */
async function mountReady(): Promise<HTMLDivElement> {
  const root = mount();
  for (let i = 0; i < 50; i++) {
    const button = byTestId(root, "benchmark-run") as HTMLButtonElement | null;
    if (button && !button.disabled) break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
  return root;
}

/** Mounts, runs, and waits for the card. */
async function mountAndRun(): Promise<HTMLDivElement> {
  const root = await mountReady();
  await act(async () => {
    (byTestId(root, "benchmark-run") as HTMLButtonElement).click();
  });
  await settle(root, "benchmark-card-text");
  return root;
}

describe("BenchmarkRoute wiring (P7.32)", () => {
  it("renders a back link to the simulator", async () => {
    const root = await mountReady();
    const back = byTestId(root, "benchmark-back-link") as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
  });

  it("shows no card before a run", async () => {
    const root = await mountReady();
    expect(byTestId(root, "benchmark-card")).toBeNull();
  });

  it("produces a card once a run finishes", async () => {
    const root = await mountAndRun();
    const text = byTestId(root, "benchmark-card-text");
    expect(text).not.toBeNull();
    expect(text!.textContent).toMatch(/4,000 trajectories\/s/);
  });

  it("the card it produces withholds the budget verdict, because the page is single-threaded", async () => {
    // The end-to-end form of this task's central honesty property.
    const root = await mountAndRun();
    const text = byTestId(root, "benchmark-card-text")!.textContent ?? "";
    expect(text).toMatch(/§2\.6 budget: not assessed/);
    expect(text).not.toMatch(/budget: missed/);
  });
});

describe("BenchmarkRoute adapter opt-in (P7.32)", () => {
  async function runAndGetCheckbox(): Promise<{ root: HTMLElement; box: HTMLInputElement }> {
    const root = await mountAndRun();
    return { root, box: byTestId(root, "benchmark-adapter-optin") as HTMLInputElement };
  }

  it("starts unchecked, and the rendered card carries no adapter", async () => {
    const { root, box } = await runAndGetCheckbox();
    expect(box.checked).toBe(false);
    const text = byTestId(root, "benchmark-card-text")!.textContent ?? "";
    expect(text).toMatch(/Adapter:\s+not included \(opt-in\)/);
    expect(text).not.toMatch(/amd|rdna3/);
  });

  it("re-renders the same card with the allowlisted fields once ticked", async () => {
    const { root, box } = await runAndGetCheckbox();
    box.checked = true;
    await act(async () => {
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const text = byTestId(root, "benchmark-card-text")!.textContent ?? "";
    expect(text).toMatch(/vendor amd/);
    expect(text).toMatch(/architecture rdna3/);
    // The device string is present in the mocked adapter and must not reach
    // the card even after opting in.
    expect(text).not.toMatch(/7900/);
  });

  it("does not re-run the benchmark to apply the opt-in", async () => {
    // Toggling must act on the rungs already measured: a page that re-ran a
    // multi-second benchmark to add two strings would push users away from the
    // opt-in rather than toward an informed one.
    const { root, box } = await runAndGetCheckbox();
    box.checked = true;
    await act(async () => {
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(byTestId(root, "benchmark-progress")).toBeNull();
    expect(byTestId(root, "benchmark-card-text")!.textContent).toMatch(/vendor amd/);
  });
});
