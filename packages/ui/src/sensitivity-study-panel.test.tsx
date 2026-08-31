// @vitest-environment jsdom
/**
 * P6.20's criterion — "recompute streams progress; cancellable" — under a real
 * render cycle. The logic tests prove the state machine; this proves the two
 * behaviours the criterion actually names reach the screen: the progress bar
 * advances *while* a study is in flight, and Cancel stops it.
 *
 * The study runner is a controllable fake rather than a real pool, for the same
 * reason `basin-panel.test.tsx` fakes its sweep runner: a test can hold the
 * study open and assert what the DOM shows *at that moment*, which is the only
 * way to check that progress streams and that Cancel is live exactly while a
 * study is.
 */
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import type { SobolIndices, Tornado } from "@ballista/analysis";
import type { SensitivityStudyProgress, SensitivityStudyResult } from "@ballista/runtime";

import { SensitivityStudyPanel, type SensitivityStudyRunner } from "./sensitivity-study-panel.js";

const TORNADO: Tornado = {
  nominal: 100,
  scale: 1,
  bars: [
    {
      input: "v0",
      index: 0,
      low: 80,
      high: 120,
      span: 40,
      halfSpan: 20,
      lowShift: -20,
      highShift: 20,
      asymmetry: 0,
      monotone: true,
      censored: false,
    },
    {
      input: "theta",
      index: 1,
      low: 95,
      high: 105,
      span: 10,
      halfSpan: 5,
      lowShift: -5,
      highShift: 5,
      asymmetry: 0,
      monotone: true,
      censored: false,
    },
  ],
  order: [0, 1],
  censored: false,
};

const SOBOL: SobolIndices = {
  baseSamples: 1024,
  evaluations: 4096,
  failures: 0,
  censored: false,
  mean: 100,
  variance: 25,
  indices: [
    {
      input: "v0",
      index: 0,
      first: 0.7,
      total: 0.75,
      interaction: 0.05,
      firstStandardError: 0.01,
      totalStandardError: 0.01,
    },
    {
      input: "theta",
      index: 1,
      first: 0.2,
      total: 0.25,
      interaction: 0.05,
      firstStandardError: 0.01,
      totalStandardError: 0.01,
    },
  ],
  firstOrderSum: 0.9,
  totalSum: 1.0,
  interactionShare: 0.1,
};

const RESULT: SensitivityStudyResult = { tornado: TORNADO, sobol: SOBOL, evaluations: 4101 };

let host: HTMLDivElement | undefined;

function mount(runStudy: SensitivityStudyRunner): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  render(<SensitivityStudyPanel runStudy={runStudy} />, host);
  return host;
}

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
});

function query(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

function click(root: HTMLElement, id: string): void {
  (query(root, id) as HTMLButtonElement).click();
}

/** A study whose resolution and progress the test drives. */
function deferredStudy(): {
  runner: SensitivityStudyRunner;
  resolve: (result: SensitivityStudyResult) => void;
  reject: (error: unknown) => void;
  report: (progress: SensitivityStudyProgress) => void;
  baseSamples: () => number | undefined;
  aborted: () => boolean;
} {
  let resolve!: (result: SensitivityStudyResult) => void;
  let reject!: (error: unknown) => void;
  let onProgress: ((progress: SensitivityStudyProgress) => void) | undefined;
  let signal: AbortSignal | undefined;
  let seenBaseSamples: number | undefined;

  const runner: SensitivityStudyRunner = (options) => {
    signal = options.signal;
    onProgress = options.onProgress;
    seenBaseSamples = options.baseSamples;
    return new Promise<SensitivityStudyResult>((res, rej) => {
      resolve = res;
      reject = rej;
      options.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    });
  };

  return {
    runner,
    resolve: (result) => resolve(result),
    reject: (error) => reject(error),
    report: (progress) => onProgress?.(progress),
    baseSamples: () => seenBaseSamples,
    aborted: () => signal?.aborted ?? false,
  };
}

/** Lets queued microtasks (the await chain inside `study`) run. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("SensitivityStudyPanel (P6.20)", () => {
  it("shows no charts before the first study, with Cancel dead", () => {
    const root = mount(async () => RESULT);

    expect(query(root, "sensitivity-study-tornado")).toBeNull();
    expect(query(root, "sensitivity-study-sobol")).toBeNull();
    expect(query(root, "sensitivity-study-status")!.textContent).toBe("Not run yet.");
    expect((query(root, "sensitivity-study-cancel") as HTMLButtonElement).disabled).toBe(true);
  });

  it("streams progress: the bar advances while the study is still in flight", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "sensitivity-study-run");
    await flush();

    // This is the half of the criterion that a finished-study assertion cannot
    // reach: the study has not resolved, and the bar is already moving.
    deferred.report({ stage: "tornado", completed: 5, total: 100 });
    await flush();
    const bar = query(root, "sensitivity-study-progress") as HTMLProgressElement;
    expect(bar).not.toBeNull();
    expect(bar.value).toBeCloseTo(0.05);
    expect(query(root, "sensitivity-study-status")!.textContent).toContain("tornado: 5 / 100");

    deferred.report({ stage: "sobol", completed: 60, total: 100 });
    await flush();
    expect((query(root, "sensitivity-study-progress") as HTMLProgressElement).value).toBeCloseTo(
      0.6,
    );
    expect(query(root, "sensitivity-study-status")!.textContent).toContain("Sobol': 60 / 100");
  });

  it("is cancellable: Cancel is live only while running, and aborts the study", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    expect((query(root, "sensitivity-study-cancel") as HTMLButtonElement).disabled).toBe(true);

    click(root, "sensitivity-study-run");
    await flush();
    expect((query(root, "sensitivity-study-cancel") as HTMLButtonElement).disabled).toBe(false);
    expect((query(root, "sensitivity-study-run") as HTMLButtonElement).disabled).toBe(true);

    click(root, "sensitivity-study-cancel");
    await flush();

    expect(deferred.aborted()).toBe(true);
    expect(query(root, "sensitivity-study-status")!.textContent).toBe(
      "Cancelled before any result was produced.",
    );
    expect((query(root, "sensitivity-study-cancel") as HTMLButtonElement).disabled).toBe(true);
    expect(query(root, "sensitivity-study-progress")).toBeNull();
  });

  it("keeps the previous charts when a later study is cancelled", async () => {
    const first = deferredStudy();
    const root = mount(first.runner);

    click(root, "sensitivity-study-run");
    await flush();
    first.resolve(RESULT);
    await flush();
    expect(query(root, "sensitivity-study-tornado")).not.toBeNull();

    click(root, "sensitivity-study-run");
    await flush();
    click(root, "sensitivity-study-cancel");
    await flush();

    // Blanking them would throw away the only correct thing on screen.
    expect(query(root, "sensitivity-study-tornado")).not.toBeNull();
    expect(query(root, "sensitivity-study-status")!.textContent).toContain(
      "Showing the previous study",
    );
  });

  it("draws both charts once a study lands, tornado scaled against its widest bar", async () => {
    const root = mount(async () => RESULT);

    click(root, "sensitivity-study-run");
    await flush();

    // CSSOM re-serialises the declaration, so the trailing zeros of "100.00%"
    // are not what ends up in the style attribute — assert what the DOM holds.
    expect((query(root, "tornado-bar-v0") as HTMLElement).style.width).toBe("100%");
    expect((query(root, "tornado-bar-theta") as HTMLElement).style.width).toBe("25%");

    // Sobol' stays on the absolute variance-share scale rather than being
    // renormalised against the largest index.
    expect((query(root, "sobol-first-bar-v0") as HTMLElement).style.width).toBe("70%");
    expect((query(root, "sobol-first-bar-theta") as HTMLElement).style.width).toBe("20%");
    expect((query(root, "sobol-total-bar-v0") as HTMLElement).style.width).toBe("75%");

    expect(query(root, "sensitivity-study-interaction")!.textContent).toContain("10.0%");
  });

  it("passes the chosen N to the study and reports it back in the status line", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    const select = query(root, "sensitivity-study-samples") as HTMLSelectElement;
    select.value = "4096";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    click(root, "sensitivity-study-run");
    await flush();
    expect(deferred.baseSamples()).toBe(4096);

    deferred.resolve(RESULT);
    await flush();
    expect(query(root, "sensitivity-study-status")!.textContent).toContain("N = 4096");
  });

  it("locks the N control while a study is running, so the label cannot drift from the result", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    expect((query(root, "sensitivity-study-samples") as HTMLSelectElement).disabled).toBe(false);
    click(root, "sensitivity-study-run");
    await flush();
    expect((query(root, "sensitivity-study-samples") as HTMLSelectElement).disabled).toBe(true);
  });

  it("reports a failure as a failure rather than as an empty result", async () => {
    const root = mount(async () => {
      throw new Error("the nominal point has no answer");
    });

    click(root, "sensitivity-study-run");
    await flush();

    expect(query(root, "sensitivity-study-status")!.textContent).toBe(
      "Failed: the nominal point has no answer",
    );
    expect(query(root, "sensitivity-study-tornado")).toBeNull();
  });

  it("flags an index the sample cannot tell from zero instead of drawing a confident bar", async () => {
    const unresolved: SensitivityStudyResult = {
      ...RESULT,
      sobol: {
        ...SOBOL,
        indices: [
          {
            input: "cd",
            index: 0,
            first: -0.02,
            total: 0.01,
            interaction: 0.03,
            firstStandardError: 0.03,
            totalStandardError: 0.03,
          },
        ],
      },
    };
    const root = mount(async () => unresolved);

    click(root, "sensitivity-study-run");
    await flush();

    expect((query(root, "sobol-first-bar-cd") as HTMLElement).style.width).toBe("0%");
    expect(query(root, "sobol-row-cd")!.textContent).toContain("raise N");
    // The negative estimate keeps its sign in the label; only the bar clamps.
    expect(query(root, "sobol-row-cd")!.textContent).toContain("-2.0%");
  });
});
