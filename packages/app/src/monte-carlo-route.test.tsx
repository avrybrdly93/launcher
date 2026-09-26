// @vitest-environment jsdom
/**
 * P6.24's criterion is "end-to-end run of golf-drive uncertainty study from
 * UI", and this is the end-to-end half: the pane's own suite fakes its runner,
 * so nothing there integrates a trajectory or proves the wiring is real.
 *
 * **jsdom has no `Worker`, so the factory is stubbed with an in-process fake
 * that runs the real `postMcResult`** -- the same shared definition a real
 * `mc-worker-entry.ts` calls -- one message per macrotask, exactly as
 * `inverse-solver-route.test.tsx` does for optimize. That makes this an
 * end-to-end check of the actual wiring (route -> pool -> study -> streamed
 * steps -> pane -> DOM) with only the thread faked.
 *
 * **What this layer therefore CANNOT prove, and where it is proved instead.**
 * The fake worker computes the study synchronously inside `postMessage`, so
 * every assertion here would hold just as well if the study still ran on the
 * calling thread. P0.119's criterion is that the UI thread stays responsive
 * under a 2048-replicate run, and that is a claim about real threads:
 * `worker-pool.e2e.test.ts` asserts it in a real Chromium page with a
 * heartbeat long-task probe, the same way P3.39's sweep criterion is asserted.
 * Nothing in this file should be read as evidence for it.
 */
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uncertainScenarioSpecSchema } from "@ballista/engine";
import { isHit } from "@ballista/analysis";
import {
  createWorkerPool,
  McCancelledError,
  postMcResult,
  type McDashboardOptions,
  type McDashboardProgress,
  type McDashboardResult,
  type McRequest,
  type WorkerLike,
} from "@ballista/runtime";

/** Every fake worker this suite's factory has handed out, newest last. */
const fakes: Array<{ terminated: () => boolean; requests: McRequest[] }> = [];

function createFakeMcWorker(): WorkerLike {
  let terminated = false;
  const requests: McRequest[] = [];
  fakes.push({ terminated: () => terminated, requests });
  const worker: WorkerLike = {
    postMessage(message) {
      const request = message as McRequest;
      requests.push(request);
      const queue: unknown[] = [];
      postMcResult((out) => queue.push(out), request);
      const drain = (index: number): void => {
        if (terminated || index >= queue.length) return;
        setTimeout(() => {
          if (terminated) return;
          worker.onmessage?.({ data: queue[index] });
          drain(index + 1);
        }, 0);
      };
      drain(0);
    },
    terminate() {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  return worker;
}

vi.mock("./mc-worker-factory.js", () => ({ createMcWorker: () => createFakeMcWorker() }));

const {
  GOLF_DRIVE_STUDY_OPTIONS,
  GOLF_DRIVE_TARGET,
  GOLF_DRIVE_TARGET_LABEL,
  GOLF_DRIVE_UNCERTAINTY_STUDY,
  MonteCarloRoute,
  golfDriveStudySpec,
} = await import("./monte-carlo-route.js");

/**
 * Runs one study through the same path the route uses -- the real pool, the
 * real `postMcResult`, the route's own spec builder -- with only the thread
 * faked. Every assertion below that used to drive the route's main-thread
 * driver now drives this, so the behaviour is asserted at the seam that
 * actually ships.
 */
function runStudyInFakeWorker(options: {
  readonly replicates: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: McDashboardProgress) => void;
  readonly studyOptions?: McDashboardOptions;
}): Promise<McDashboardResult> {
  const pool = createWorkerPool({ createWorker: createFakeMcWorker, size: 1 });
  return pool
    .runMc(golfDriveStudySpec(options.replicates), {
      studyOptions: options.studyOptions ?? GOLF_DRIVE_STUDY_OPTIONS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    })
    .finally(() => pool.terminate());
}

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
  document.body.append(host);
  render(<MonteCarloRoute />, host);
  return host;
}

describe("MonteCarloRoute (P6.24)", () => {
  it("renders the route shell the router and the e2e walk look for", () => {
    const root = mount();
    expect(root.querySelector('[data-testid="monte-carlo-route"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="monte-carlo-back-link"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="monte-carlo-page"]')).not.toBeNull();
  });

  it("shows no results until a study is asked for", () => {
    const root = mount();
    expect(root.querySelector('[data-testid="mc-histogram"]')).toBeNull();
    expect(root.querySelector('[data-testid="mc-status"]')!.textContent).toBe("No study run yet.");
  });

  it("says out loud that the study runs in a worker (P0.119)", () => {
    // The honesty requirement this route carries, now pointing the other way:
    // before P0.119 this asserted the page admitted the work was on the UI
    // thread. The sentence had to change with the behaviour -- a page still
    // claiming the old thing would be the defect.
    const text = mount().textContent;
    expect(text).toContain("runs in a worker");
    expect(text).not.toContain("runs on this thread");
  });

  it("actually constructs a worker and sends it an mc request when a study is asked for", async () => {
    // The wiring assertion the pane's own suite cannot make: the pane is given
    // a runner and cannot tell what is behind it. This checks the route's
    // runner reaches a Worker at all, rather than quietly still draining the
    // generator on this thread.
    const before = fakes.length;
    const root = mount();
    expect(fakes.length).toBe(before + 1);

    root.querySelector<HTMLButtonElement>('[data-testid="mc-run"]')!.click();
    await vi.waitFor(() => {
      expect(fakes[before]!.requests.length).toBe(1);
    });
    expect(fakes[before]!.requests[0]!.kind).toBe("mc");
    expect(fakes[before]!.requests[0]!.spec.target).toEqual(GOLF_DRIVE_TARGET);
  });
});

describe("MonteCarloRoute reports what the ensemble will actually run on (P7.13)", () => {
  it("mounts the capability panel, and it resolves to the CPU path in this container", async () => {
    // jsdom has no `navigator.gpu`, so this is the criterion -- "unsupported
    // browsers get graceful CPU path" -- measured on an unsupported browser
    // rather than simulated with a fake one.
    const root = mount();
    const panel = () => root.querySelector('[data-testid="capability-panel"]');
    expect(panel()).not.toBeNull();

    // The probe is async; before it resolves the panel says so rather than
    // rendering blank.
    expect(root.querySelector('[data-testid="capability-pending"]')).not.toBeNull();

    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="capability-webgpu-unsupported"]')).not.toBeNull();
    });

    const headline = root.querySelector('[data-testid="capability-headline"]')?.textContent ?? "";
    expect(headline).toContain("TypeScript reference stepper");
  });

  it("tells the user what runs instead, rather than only that WebGPU is absent", async () => {
    // The un-graceful outcome is a panel that reports an absence and stops.
    // This asserts the sentence that names the replacement actually reaches
    // the DOM on the route, not just in the panel's own unit test.
    const root = mount();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="capability-fallback"]')).not.toBeNull();
    });
    const fallback = root.querySelector('[data-testid="capability-fallback"]')?.textContent ?? "";
    expect(fallback).toContain("simulation is unaffected");
    expect(fallback).toContain("TypeScript reference stepper");
  });
});

describe("the golf-drive study is a real, varying study", () => {
  it("parses against the schema, which checks every overlay path resolves", () => {
    // uncertainScenarioSpecSchema's refinement rejects a path that does not
    // land on a finite number in *this* base -- so a typo in "spin0" or a
    // model without a spin channel fails here rather than producing an
    // ensemble that silently never varies.
    expect(() => uncertainScenarioSpecSchema.parse(GOLF_DRIVE_UNCERTAINTY_STUDY)).not.toThrow();
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.overlays.map((o) => o.path)).toEqual([
      "initialConditions.vx0",
      "initialConditions.vy0",
      "initialConditions.spin0",
    ]);
  });

  it("is the Magnus-bearing golf drive, not whichever preset shared a projectile id", () => {
    // P0.115: two presets share a projectile id, so the lookup is by curated
    // scenario id. Backspin is the whole point of this scenario.
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.base.model.forceIds).toContain("magnus");
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.base.initialConditions.spin0).toBeGreaterThan(0);
  });

  it("produces an ensemble with real spread when actually integrated", async () => {
    const result = await runStudyInFakeWorker({ replicates: 12 });
    expect(result.stats.count).toBe(12);
    expect(result.stats.landedCount).toBe(12);
    expect(result.stats.range.variance).toBeGreaterThan(0);
    // A golf drive carries a few hundred metres; this is a sanity band, not a
    // golden value -- it exists to catch a study wired to the wrong base.
    expect(result.stats.range.mean).toBeGreaterThan(50);
    expect(result.stats.range.mean).toBeLessThan(1000);
  });

  it("scores the hit probability against the documented target, not a reinvented one", async () => {
    const result = await runStudyInFakeWorker({ replicates: 12 });
    // Recount the hits from the columns using targets.ts' own predicate, and
    // by a *different* route to the impact point than the study takes: the
    // study reads `impactPoint` off the observable sink, this rebuilds it as
    // (range, 0), which is the same point only because this base launches from
    // the origin onto flat ground. If the route ever scored against a target
    // other than the one it labels, the two disagree.
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.base.initialConditions.x0).toBe(0);
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.base.initialConditions.y0).toBe(0);
    let expected = 0;
    for (let i = 0; i < result.columns.range.length; i += 1) {
      if (result.columns.landed[i] !== 1) continue;
      if (isHit(GOLF_DRIVE_TARGET, [result.columns.range[i] as number, 0])) expected += 1;
    }
    expect(result.hit.hits).toBe(expected);
    expect(result.hit.shots).toBe(result.stats.landedCount);
  });

  it("labels the target with the numbers the target actually carries", () => {
    // A caption that drifts from the geometry is the quiet failure here: the
    // reader trusts the words, not the object.
    expect(GOLF_DRIVE_TARGET_LABEL).toContain(String(GOLF_DRIVE_TARGET.tolerance));
    expect(GOLF_DRIVE_TARGET_LABEL).toContain(String(GOLF_DRIVE_TARGET.center[0]));
  });
});

describe("Cancel stops the study (P0.119: it terminates the worker)", () => {
  it("the study reaches the caller a step at a time, not all at the end", async () => {
    // Before P0.119 this asserted the main-thread driver yielded to the event
    // loop. Yielding is no longer what makes Cancel real -- the work is on
    // another thread -- but the streaming still has to be genuine: a macrotask
    // queued before the run must be able to run before the last progress
    // report arrives. This is the strongest thing an in-process fake can say;
    // the responsiveness claim itself belongs to the e2e heartbeat probe (see
    // this file's header).
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);

    let flagAtEnd = false;
    await runStudyInFakeWorker({
      replicates: 12,
      onProgress: () => {
        flagAtEnd = macrotaskRan;
      },
    });
    expect(flagAtEnd).toBe(true);
  });

  it("rejects with McCancelledError and terminates the worker when the signal fires mid-study", async () => {
    const controller = new AbortController();
    const seen: McDashboardProgress[] = [];
    const before = fakes.length;

    const promise = runStudyInFakeWorker({
      replicates: 400,
      signal: controller.signal,
      onProgress: (progress) => {
        seen.push(progress);
        // Abort on the second report rather than at a fixed `completed`:
        // progress is throttled now, so no particular count is guaranteed to
        // be delivered.
        if (seen.length === 2) controller.abort();
      },
    });

    // Not an AbortError any more, and the pane is unaffected: it decides a run
    // was cancelled from `controller.signal.aborted`, not from the error's name.
    await expect(promise).rejects.toBeInstanceOf(McCancelledError);
    expect(fakes[before]!.terminated()).toBe(true);
    // And it really stopped: a study that only checked the signal at the end
    // would have reported the whole 400-replicate ensemble before rejecting.
    expect(seen.length).toBeLessThan(50);
  });

  it("does not start at all when handed an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const seen: McDashboardProgress[] = [];
    const before = fakes.length;

    await expect(
      runStudyInFakeWorker({
        replicates: 12,
        signal: controller.signal,
        onProgress: (progress) => seen.push(progress),
      }),
    ).rejects.toBeInstanceOf(McCancelledError);
    expect(seen).toHaveLength(0);
    // Nothing was even posted to the worker, which is what "does not start"
    // has to mean now that the work is on the other side of a message.
    expect(fakes[before]!.requests).toHaveLength(0);
  });

  it("runs the N it is given, not the number the spec happens to carry", async () => {
    // The spec's `replicates` is a required schema field; the pane's control is
    // what decides the run. A route that forgot to override it would quietly
    // integrate 512 trajectories every time.
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.replicates).toBe(512);
    const result = await runStudyInFakeWorker({ replicates: 10 });
    expect(result.stats.count).toBe(10);
  });
});

describe("P6.25 the route streams live estimates from a real study", () => {
  it("delivers partial estimates through the driver, not just counts", async () => {
    // End to end on the real golf drive: the criterion is about what reaches
    // the pane, and the pane is fed by exactly this callback.
    const partials: NonNullable<McDashboardProgress["partial"]>[] = [];
    await runStudyInFakeWorker({
      replicates: 32,
      onProgress: (progress) => {
        if (progress.partial !== undefined) partials.push(progress.partial);
      },
    });

    expect(partials.length).toBeGreaterThan(1);
    // Nested prefixes of one ensemble, so the sample size only grows.
    const sizes = partials.map((p) => p.sampled);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes.at(-1)).toBe(32);
  });

  it("the final streamed estimate is the one the result carries", async () => {
    // If these differed, the number on screen would jump at the instant the
    // run completed, for no reason a reader could account for.
    let last: NonNullable<McDashboardProgress["partial"]> | undefined;
    const result = await runStudyInFakeWorker({
      replicates: 24,
      onProgress: (progress) => {
        if (progress.partial !== undefined) last = progress.partial;
      },
    });

    expect(last).toBeDefined();
    expect(last!.hit).toEqual(result.hit);
    expect(last!.unlandedCount).toBe(result.unlandedCount);
  });

  it("the interval is tighter at the end of a run than at its first estimate", async () => {
    const partials: NonNullable<McDashboardProgress["partial"]>[] = [];
    await runStudyInFakeWorker({
      replicates: 64,
      onProgress: (progress) => {
        if (progress.partial !== undefined) partials.push(progress.partial);
      },
    });

    const width = (p: (typeof partials)[number]) => p.hit.upper - p.hit.lower;
    expect(partials.length).toBeGreaterThan(2);
    expect(width(partials.at(-1)!)).toBeLessThan(width(partials[0]!));
  });
});
