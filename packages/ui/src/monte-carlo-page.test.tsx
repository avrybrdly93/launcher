// @vitest-environment jsdom
/**
 * P6.24 under a real render cycle. The logic tests prove the state machine and
 * the geometry; this proves the behaviours that only exist once something is on
 * screen: the four sections appear together and only after a study, progress
 * streams while one is in flight, Cancel is live exactly then, and the fan's
 * conditional-support caveat reaches the page rather than staying in a comment.
 *
 * The runner is a controllable fake rather than a real study, for the reason
 * `sensitivity-study-panel.test.tsx` fakes its own: a test can hold the study
 * open and assert what the DOM shows *at that moment*.
 */
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import { ESTIMATOR_GLOSSARY_ADR, type EnsembleFan } from "@ballista/analysis";
import type { McDashboardProgress, McDashboardResult } from "@ballista/runtime";

import { MonteCarloPage, type McStudyRunner } from "./monte-carlo-page.js";

const FAN: EnsembleFan = {
  grid: Float64Array.from([0, 1, 2]),
  levels: [0.05, 0.5, 0.95],
  bands: [
    Float64Array.from([0, 5, 0]),
    Float64Array.from([0, 10, 0]),
    Float64Array.from([0, 20, Number.NaN]),
  ],
  sampleCount: Int32Array.from([3, 3, 2]),
  replicateCount: 3,
  commonSupportEnd: 1,
};

const RESULT: McDashboardResult = {
  columns: {
    range: Float64Array.from([100, 110, 120, 130]),
    apexHeight: Float64Array.from([10, 11, 12, 13]),
    timeOfFlight: Float64Array.from([2, 2.1, 2.2, 2.3]),
    impactSpeed: Float64Array.from([30, 31, 32, 33]),
    landed: Uint8Array.from([1, 1, 1, 1]),
  },
  stats: {
    count: 4,
    landedCount: 4,
    range: { sum: 460, sumSquares: 53000, min: 100, max: 130, mean: 115, variance: 500 / 3 },
    apexHeight: { sum: 46, sumSquares: 534, min: 10, max: 13, mean: 11.5, variance: 5 / 3 },
    timeOfFlight: { sum: 8.6, sumSquares: 18.54, min: 2, max: 2.3, mean: 2.15, variance: 0.0167 },
    impactSpeed: { sum: 126, sumSquares: 3974, min: 30, max: 33, mean: 31.5, variance: 5 / 3 },
  },
  hit: {
    successes: 3,
    trials: 4,
    hits: 3,
    shots: 4,
    pHat: 0.75,
    center: 0.7,
    lower: 0.3,
    upper: 0.95,
    level: 0.95,
  },
  unlandedCount: 0,
  fan: FAN,
  fanReplicates: 3,
  cost: { ensemble: 4, fan: 3, total: 7 },
};

let host: HTMLDivElement | undefined;

function mount(runStudy: McStudyRunner): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  render(<MonteCarloPage runStudy={runStudy} targetLabel="a pin 180 m out" />, host);
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
  runner: McStudyRunner;
  resolve: (result: McDashboardResult) => void;
  reject: (error: unknown) => void;
  report: (progress: McDashboardProgress) => void;
  replicates: () => number | undefined;
  aborted: () => boolean;
} {
  let resolve!: (result: McDashboardResult) => void;
  let reject!: (error: unknown) => void;
  let onProgress: ((progress: McDashboardProgress) => void) | undefined;
  let signal: AbortSignal | undefined;
  let seenReplicates: number | undefined;

  const runner: McStudyRunner = (options) => {
    signal = options.signal;
    onProgress = options.onProgress;
    seenReplicates = options.replicates;
    return new Promise<McDashboardResult>((res, rej) => {
      resolve = res;
      reject = rej;
      options.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    });
  };

  return {
    runner,
    resolve: (value) => resolve(value),
    reject: (error) => reject(error),
    report: (value) => onProgress?.(value),
    replicates: () => seenReplicates,
    aborted: () => signal?.aborted ?? false,
  };
}

/** Lets queued microtasks (the await chain inside `study`) run. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("MonteCarloPage (P6.24)", () => {
  it("shows no output sections before the first study, with Cancel dead", () => {
    const root = mount(async () => RESULT);

    for (const id of ["mc-estimate", "mc-hit", "mc-histogram", "mc-fan"]) {
      expect(query(root, id)).toBeNull();
    }
    expect(query(root, "mc-status")!.textContent).toBe("No study run yet.");
    expect((query(root, "mc-cancel") as HTMLButtonElement).disabled).toBe(true);
  });

  it("streams progress: the bar advances while the study is still in flight", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    // Before any report the bar is indeterminate -- no `value` attribute --
    // because "nothing done yet" and "not started" must not look alike.
    expect((query(root, "mc-progress") as HTMLProgressElement).hasAttribute("value")).toBe(false);

    deferred.report({ stage: "ensemble", completed: 2, total: 8 });
    await flush();
    expect((query(root, "mc-progress") as HTMLProgressElement).value).toBeCloseTo(0.25, 12);
    expect(query(root, "mc-status")!.textContent).toBe("sampling: 2 / 8 replicates");

    deferred.report({ stage: "fan", completed: 6, total: 8 });
    await flush();
    expect(query(root, "mc-status")!.textContent).toBe("recording trajectories: 6 / 8 replicates");

    // Still running: nothing has resolved.
    expect(query(root, "mc-histogram")).toBeNull();
    deferred.resolve(RESULT);
    await flush();
    expect(query(root, "mc-histogram")).not.toBeNull();
  });

  it("Cancel is live exactly while a study is in flight, and aborts the signal", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    expect((query(root, "mc-cancel") as HTMLButtonElement).disabled).toBe(true);
    click(root, "mc-run");
    await flush();
    expect((query(root, "mc-cancel") as HTMLButtonElement).disabled).toBe(false);
    expect(deferred.aborted()).toBe(false);

    click(root, "mc-cancel");
    await flush();
    expect(deferred.aborted()).toBe(true);
    expect(query(root, "mc-status")!.textContent).toBe("Cancelled before any result.");
    expect((query(root, "mc-cancel") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders all four output families once a study lands", async () => {
    const root = mount(async () => RESULT);
    click(root, "mc-run");
    await flush();

    expect(query(root, "mc-range-estimate")!.textContent).toContain("n = 4");
    expect(query(root, "mc-hit-estimate")!.textContent).toContain("75.0%");
    expect(query(root, "mc-bin-0")).not.toBeNull();
    expect(query(root, "mc-fan-svg")).not.toBeNull();
    expect(query(root, "mc-status")!.textContent).toBe("Study complete at N = 512.");
  });

  it("draws one polyline per quantile level, and the conditional-support marker", async () => {
    const root = mount(async () => RESULT);
    click(root, "mc-run");
    await flush();

    for (const level of FAN.levels) {
      const band = query(root, `mc-fan-band-${level}`);
      expect(band).not.toBeNull();
      expect(band!.getAttribute("points")!.length).toBeGreaterThan(0);
    }
    expect(query(root, "mc-fan-common-support")).not.toBeNull();
    expect(query(root, "mc-fan-support-note")!.textContent).toContain("conditional on survival");
  });

  it("says so when no grid point has every replicate, rather than drawing a marker anyway", async () => {
    const root = mount(async () => ({
      ...RESULT,
      fan: { ...FAN, commonSupportEnd: Number.NaN },
    }));
    click(root, "mc-run");
    await flush();

    expect(query(root, "mc-fan-common-support")).toBeNull();
    expect(query(root, "mc-fan-support-note")!.textContent).toContain(
      "No grid point has every replicate in flight",
    );
  });

  it("passes the chosen N to the runner and labels the result with it", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    const select = query(root, "mc-replicates") as HTMLSelectElement;
    select.value = "256";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    // Preact schedules the re-render on a microtask, and the click handler is
    // the closure from the *rendered* tree -- so the flush is what a real user
    // gets for free by taking longer than zero milliseconds to move the mouse.
    await flush();

    click(root, "mc-run");
    await flush();
    expect(deferred.replicates()).toBe(256);

    deferred.resolve(RESULT);
    await flush();
    expect(query(root, "mc-status")!.textContent).toBe("Study complete at N = 256.");
  });

  it("disables the N control while a study runs, so the label cannot drift", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    expect((query(root, "mc-replicates") as HTMLSelectElement).disabled).toBe(false);
    click(root, "mc-run");
    await flush();
    expect((query(root, "mc-replicates") as HTMLSelectElement).disabled).toBe(true);
  });

  it("keeps the finished study on screen when a later run is cancelled", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    deferred.resolve(RESULT);
    await flush();
    expect(query(root, "mc-histogram")).not.toBeNull();

    click(root, "mc-run");
    await flush();
    click(root, "mc-cancel");
    await flush();

    // Still there: the first study is a true description of the ensemble it
    // ran on, and abandoning a second one is no reason to blank it.
    expect(query(root, "mc-histogram")).not.toBeNull();
    expect(query(root, "mc-status")!.textContent).toContain("Showing the previous study");
  });

  it("reports a failure's message instead of silently showing stale numbers", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    deferred.reject(new Error("model refused"));
    await flush();

    expect(query(root, "mc-status")!.textContent).toBe("Study failed: model refused");
  });

  it("aborts a study in flight when the page unmounts", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    expect(deferred.aborted()).toBe(false);

    render(null, root);
    await flush();
    // Otherwise the study outlives the page and keeps integrating trajectories
    // nobody will read.
    expect(deferred.aborted()).toBe(true);
  });
});

describe("MonteCarloPage live estimate (P6.25)", () => {
  /** A progress report carrying a partial whose interval has the given half-width. */
  function withPartial(completed: number, sampled: number, halfWidth: number): McDashboardProgress {
    return {
      stage: "ensemble",
      completed,
      total: 40,
      partial: {
        hit: {
          successes: Math.round(sampled / 2),
          trials: sampled,
          hits: Math.round(sampled / 2),
          shots: sampled,
          pHat: 0.5,
          center: 0.5,
          lower: 0.5 - halfWidth,
          upper: 0.5 + halfWidth,
          level: 0.95,
        },
        sampled,
        unlandedCount: 0,
      },
    } as McDashboardProgress;
  }

  it("shows nothing until a partial arrives", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    expect(query(root, "mc-live-estimate")).toBeNull();

    // A count-only report is not an estimate, and must not render as one.
    deferred.report({ stage: "ensemble", completed: 4, total: 40 });
    await flush();
    expect(query(root, "mc-live-estimate")).toBeNull();
  });

  it("renders the estimate once a partial arrives, with its sample size", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    deferred.report(withPartial(16, 16, 0.25));
    await flush();

    const section = query(root, "mc-live-estimate");
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("16 replicate(s) drawn so far");
    expect(query(root, "mc-live-hit-estimate")!.textContent).not.toBe("");
  });

  it("the displayed interval narrows as later partials arrive — the criterion", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    deferred.report(withPartial(16, 16, 0.25));
    await flush();
    const early = query(root, "mc-live-hit-estimate")!.textContent;

    deferred.report(withPartial(32, 256, 0.05));
    await flush();
    const late = query(root, "mc-live-hit-estimate")!.textContent;

    // The rendered text must actually change, not merely be recomputed: this is
    // what "CI band visibly narrows during run" means at the layer a reader
    // sees. Both are non-empty and they differ.
    expect(early).not.toBe("");
    expect(late).not.toBe(early);
    expect(query(root, "mc-live-estimate")!.textContent).toContain("256 replicate(s)");
  });

  it("disappears when the study completes, leaving one hit estimate on screen", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    deferred.report(withPartial(32, 32, 0.1));
    await flush();
    expect(query(root, "mc-live-estimate")).not.toBeNull();

    deferred.resolve(RESULT);
    await flush();
    // Two intervals for the same quantity side by side would be a worse
    // dashboard than one; the finished result owns the section from here.
    expect(query(root, "mc-live-estimate")).toBeNull();
    expect(query(root, "mc-hit")).not.toBeNull();
  });

  it("disappears on cancel, so a stale estimate is not left looking live", async () => {
    const deferred = deferredStudy();
    const root = mount(deferred.runner);

    click(root, "mc-run");
    await flush();
    deferred.report(withPartial(16, 16, 0.25));
    await flush();
    expect(query(root, "mc-live-estimate")).not.toBeNull();

    click(root, "mc-cancel");
    await flush();
    expect(query(root, "mc-live-estimate")).toBeNull();
  });
});

describe("the dashboard's estimator help (P6.30 validation: linked from dashboard help)", () => {
  it("mounts the help panel before a study has been run, since it informs the choice to run one", () => {
    // Asserted on the freshly mounted page rather than after a result: the
    // question the panel answers -- which estimator does this question want --
    // is asked before the four result sections exist.
    const root = mount(() => new Promise<McDashboardResult>(() => {}));
    expect(query(root, "estimator-help")).not.toBeNull();
    expect(query(root, "mc-estimate")).toBeNull();
  });

  it("links ADR-019 from that panel", () => {
    const root = mount(() => new Promise<McDashboardResult>(() => {}));
    const link = query(root, "estimator-help-adr-link");
    expect(link).not.toBeNull();
    // The href is derived from the glossary's published path, so moving the
    // ADR breaks this rather than leaving a dead link on the dashboard.
    expect(link!.getAttribute("href")).toContain(ESTIMATOR_GLOSSARY_ADR);
  });

  it("keeps the help collapsed, so it does not displace the study controls", () => {
    const root = mount(() => new Promise<McDashboardResult>(() => {}));
    expect((query(root, "estimator-help") as HTMLDetailsElement).open).toBe(false);
    expect(query(root, "mc-run")).not.toBeNull();
  });
});
