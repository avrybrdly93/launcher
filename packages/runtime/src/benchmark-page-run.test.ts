/**
 * Page-run tests (P7.32).
 *
 * Small replicate counts throughout: these assert the *driving* -- progress
 * accounting, ladder coverage, what the clock is wrapped around, and the
 * thread count the card will read a verdict from -- not the physics, which
 * `batch-throughput.test.ts` and the golden suites already own.
 */

import { describe, expect, it } from "vitest";
import { THROUGHPUT_STEP_LADDER, verdictRung, type LadderRung } from "./batch-throughput.js";
import { budgetVerdict } from "./benchmark-result-card.js";
import {
  PAGE_CHUNK,
  benchmarkPageSteps,
  pageRunTotal,
  type BenchmarkPageRunOptions,
} from "./benchmark-page-run.js";

/** A clock that advances a fixed amount per read, and counts its reads. */
function countingClock(stepMs: number) {
  let value = 0;
  let calls = 0;
  return {
    now: (): number => {
      calls += 1;
      value += stepMs;
      return value;
    },
    get calls(): number {
      return calls;
    },
  };
}

function drain(replicates: number, options: BenchmarkPageRunOptions = {}) {
  const steps = [...benchmarkPageSteps(replicates, options)];
  const rungs = steps.map((s) => s.rung).filter((r): r is LadderRung => r !== undefined);
  return { steps, rungs };
}

describe("benchmarkPageSteps drives the whole ladder (P7.32)", () => {
  it("reports one rung per ladder step, in the ladder's order", () => {
    const { rungs } = drain(4);
    expect(rungs.map((r) => r.stepSize)).toEqual([...THROUGHPUT_STEP_LADDER]);
  });

  it("ends with completed exactly equal to the total it advertised", () => {
    const replicates = 4;
    const { steps } = drain(replicates);
    const last = steps.at(-1)!;
    expect(last.total).toBe(pageRunTotal(replicates));
    expect(last.completed).toBe(last.total);
  });

  it("never reports progress that goes backwards or overshoots", () => {
    const { steps } = drain(4);
    let previous = 0;
    for (const step of steps) {
      expect(step.completed).toBeGreaterThanOrEqual(previous);
      expect(step.completed).toBeLessThanOrEqual(step.total);
      previous = step.completed;
    }
  });

  it("yields often enough for a page to repaint, not once per rung", () => {
    // 4 rungs of 4 replicates is one chunk each, so the interesting case is a
    // rung larger than PAGE_CHUNK: it must produce several progress steps.
    const replicates = PAGE_CHUNK * 2;
    const { steps } = drain(replicates);
    const perRung = steps.filter((s) => s.rung === undefined).length;
    expect(perRung).toBeGreaterThanOrEqual(THROUGHPUT_STEP_LADDER.length * 2);
  });

  it("computes a real ensemble — every rung has a finite, non-degenerate error", () => {
    const { rungs } = drain(4);
    for (const rung of rungs) {
      expect(Number.isFinite(rung.relativeRangeError)).toBe(true);
      expect(rung.trajectoriesPerSecond).toBeGreaterThan(0);
    }
  });
});

describe("what the page's clock is wrapped around (P7.32)", () => {
  it("derives elapsed seconds from the injected clock, not a real one", () => {
    const clock = countingClock(250);
    const { rungs } = drain(4, { now: clock.now });
    // Start and end reads are 250 ms apart by construction.
    for (const rung of rungs) expect(rung.elapsedSeconds).toBeCloseTo(0.25, 10);
    expect(clock.calls).toBe(THROUGHPUT_STEP_LADDER.length * 2);
  });

  it("excludes the accuracy leg from the timing, priced on the same clock", () => {
    // THE WEAKER VERSION OF THIS TEST COUNTED CLOCK READS AND A CONTROL RUN
    // SHOWED IT PASSING WITH THE ACCURACY LEG MOVED *INSIDE* THE TIMED
    // SECTION -- two reads per rung either way. So the accuracy measurement is
    // injected and made expensive on the very clock the rung is timed with:
    // 10 s of charged time per rung. If it were inside, every rung's elapsed
    // would carry it and the assertion below could not hold.
    //
    // The accuracy replicate is an adaptive solve, which is a workload no
    // batch runs; measure-batch-throughput.mjs keeps it out of the timing for
    // the same reason.
    let charged = 0;
    const base = countingClock(250);
    const now = (): number => base.now() + charged;
    const { rungs } = drain(4, {
      now,
      measureAccuracy: (): number => {
        charged += 10_000;
        return 1e-12;
      },
    });

    expect(rungs).toHaveLength(THROUGHPUT_STEP_LADDER.length);
    for (const rung of rungs) {
      expect(rung.elapsedSeconds).toBeCloseTo(0.25, 10);
      expect(rung.elapsedSeconds).toBeLessThan(10);
    }
  });
});

describe("a page run is a single-threaded run, and the card must see that (P7.32)", () => {
  it("reports one worker on every rung", () => {
    const { rungs } = drain(4);
    for (const rung of rungs) expect(rung.workers).toBe(1);
  });

  it("therefore yields no §2.6 verdict, whatever the rate came out at", () => {
    // The end-to-end statement of this task's central honesty property: the
    // page cannot produce a rung the card will read a budget verdict from.
    const { rungs } = drain(4);
    for (const rung of rungs) expect(budgetVerdict(rung, rung.workers)).toBe("not-applicable");
  });

  it("still produces rungs verdictRung can choose between", () => {
    // Withholding the budget verdict must not mean the accuracy machinery is
    // bypassed: the card is built from the coarsest accurate rung, so one has
    // to be selectable.
    const { rungs } = drain(4);
    const chosen = verdictRung(rungs);
    if (chosen) expect(THROUGHPUT_STEP_LADDER).toContain(chosen.stepSize);
    else expect(rungs.length).toBe(THROUGHPUT_STEP_LADDER.length);
  });
});
