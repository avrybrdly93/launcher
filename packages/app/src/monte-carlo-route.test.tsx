// @vitest-environment jsdom
/**
 * P6.24's criterion is "end-to-end run of golf-drive uncertainty study from
 * UI", and this is the end-to-end half: the pane's own suite fakes its runner,
 * so nothing there integrates a trajectory or proves the wiring is real.
 *
 * Two things are checked that only this layer can check. First that the study
 * this route hands the pane is a *valid, varying* golf-drive study whose
 * numbers come out of a real integration. Second that `runGolfDriveStudy` --
 * the driver that makes the pane's Cancel button mean something -- actually
 * yields to the event loop and actually stops when the signal fires. A
 * synchronous driver would pass every assertion the pane's suite makes and
 * still freeze the tab.
 */
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { uncertainScenarioSpecSchema } from "@ballista/engine";
import { isHit } from "@ballista/analysis";
import type { McDashboardProgress } from "@ballista/runtime";

import {
  GOLF_DRIVE_TARGET,
  GOLF_DRIVE_TARGET_LABEL,
  GOLF_DRIVE_UNCERTAINTY_STUDY,
  MonteCarloRoute,
  runGolfDriveStudy,
} from "./monte-carlo-route.js";

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

  it("says out loud that the study runs on this thread", () => {
    // The honesty requirement this route carries: a reader should not have to
    // discover from a frozen tab that the work is not in a worker.
    expect(mount().textContent).toContain("runs on this thread");
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
    const result = await runGolfDriveStudy({ replicates: 12, yieldEvery: 1000 });
    expect(result.stats.count).toBe(12);
    expect(result.stats.landedCount).toBe(12);
    expect(result.stats.range.variance).toBeGreaterThan(0);
    // A golf drive carries a few hundred metres; this is a sanity band, not a
    // golden value -- it exists to catch a study wired to the wrong base.
    expect(result.stats.range.mean).toBeGreaterThan(50);
    expect(result.stats.range.mean).toBeLessThan(1000);
  });

  it("scores the hit probability against the documented target, not a reinvented one", async () => {
    const result = await runGolfDriveStudy({ replicates: 12, yieldEvery: 1000 });
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

describe("runGolfDriveStudy keeps Cancel honest", () => {
  it("yields to the event loop rather than running the study in one block", async () => {
    // The assertion that a synchronous driver fails. A macrotask queued
    // *before* the study starts must be able to run *during* it; if the driver
    // never yielded, the study would finish first and the flag would still be
    // false when the first progress report arrives after it.
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);

    let flagAtEnd = false;
    await runGolfDriveStudy({
      replicates: 12,
      yieldEvery: 2,
      onProgress: () => {
        flagAtEnd = macrotaskRan;
      },
    });
    expect(flagAtEnd).toBe(true);
  });

  it("rejects with an AbortError when the signal fires mid-study", async () => {
    const controller = new AbortController();
    const seen: McDashboardProgress[] = [];

    const promise = runGolfDriveStudy({
      replicates: 400,
      yieldEvery: 2,
      signal: controller.signal,
      onProgress: (progress) => {
        seen.push(progress);
        if (progress.completed === 6) controller.abort();
      },
    });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // And it really stopped: a driver that only checked the signal at the end
    // would have reported all 400 ensemble steps before rejecting.
    expect(seen.length).toBeLessThan(50);
  });

  it("does not start at all when handed an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const seen: McDashboardProgress[] = [];

    await expect(
      runGolfDriveStudy({
        replicates: 12,
        signal: controller.signal,
        onProgress: (progress) => seen.push(progress),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toHaveLength(0);
  });

  it("runs the N it is given, not the number the spec happens to carry", async () => {
    // The spec's `replicates` is a required schema field; the pane's control is
    // what decides the run. A route that forgot to override it would quietly
    // integrate 512 trajectories every time.
    expect(GOLF_DRIVE_UNCERTAINTY_STUDY.replicates).toBe(512);
    const result = await runGolfDriveStudy({ replicates: 10, yieldEvery: 1000 });
    expect(result.stats.count).toBe(10);
  });
});

describe("P6.25 the route streams live estimates from a real study", () => {
  it("delivers partial estimates through the driver, not just counts", async () => {
    // End to end on the real golf drive: the criterion is about what reaches
    // the pane, and the pane is fed by exactly this callback.
    const partials: NonNullable<McDashboardProgress["partial"]>[] = [];
    await runGolfDriveStudy({
      replicates: 32,
      yieldEvery: 1000,
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
    const result = await runGolfDriveStudy({
      replicates: 24,
      yieldEvery: 1000,
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
    await runGolfDriveStudy({
      replicates: 64,
      yieldEvery: 1000,
      onProgress: (progress) => {
        if (progress.partial !== undefined) partials.push(progress.partial);
      },
    });

    const width = (p: (typeof partials)[number]) => p.hit.upper - p.hit.lower;
    expect(partials.length).toBeGreaterThan(2);
    expect(width(partials.at(-1)!)).toBeLessThan(width(partials[0]!));
  });
});
