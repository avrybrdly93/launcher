import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { G_STD } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import {
  GOLDEN_OPTIMIZATION_CASES,
  runGoldenOptimization,
  type GoldenOptimizationOutcome,
} from "./golden-optimization-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "golden-optimizations.json");

interface GoldenOptimizationEntry extends GoldenOptimizationOutcome {
  readonly id: string;
}

interface GoldenOptimizationFixture {
  readonly schemaVersion: 1;
  readonly provenance: string;
  readonly entries: readonly GoldenOptimizationEntry[];
}

function recordFixture(): GoldenOptimizationFixture {
  return {
    schemaVersion: 1,
    provenance:
      "Recorded via `UPDATE_GOLDENS=1 pnpm run update-goldens` (P5.25; blueprint §7). Any " +
      "intentional change to an inverse solver requires re-running that command with a commit " +
      "message explaining *why* a solution or an iteration count moved -- never hand-edit this " +
      "file. The tolerances these values are compared against are not stored here: they live " +
      "in `golden-optimization-store.ts` next to the reasoning for each one, so that widening " +
      "one is a reviewable source change rather than a number edited in a fixture.",
    entries: GOLDEN_OPTIMIZATION_CASES.map((c) => ({ id: c.id, ...c.run() })),
  };
}

/**
 * One run per case, shared by every assertion below that only needs *an* outcome.
 *
 * These cases integrate trajectories -- `nelder-mead-quadratic-drag-point` spends about 1600
 * of them -- so running a case once per assertion costs real time in a suite that already runs
 * a browser-driven app-shell test against a 60 s hook budget in the same worker pool. Cached
 * here rather than made cheaper, so that no coverage is traded for the saving: the determinism
 * test below still performs a genuine second run and compares it against this first one.
 */
const firstRun = new Map<string, GoldenOptimizationOutcome>();

function once(id: string): GoldenOptimizationOutcome {
  const cached = firstRun.get(id);
  if (cached !== undefined) return cached;
  const outcome = runGoldenOptimization(id);
  firstRun.set(id, outcome);
  return outcome;
}

function loadFixture(): GoldenOptimizationFixture {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Golden optimization fixture missing at ${FIXTURE_PATH}. Run "pnpm run update-goldens" to record it.`,
    );
  }
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GoldenOptimizationFixture;
}

describe("golden optimization results (P5.25)", () => {
  if (process.env["UPDATE_GOLDENS"] === "1") {
    it("records a fresh golden fixture (UPDATE_GOLDENS=1)", () => {
      const fixture = recordFixture();
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
      expect(fixture.entries).toHaveLength(GOLDEN_OPTIMIZATION_CASES.length);
    });
    return;
  }

  const fixture = loadFixture();

  it("the fixture covers every case exactly once, in the store's order", () => {
    expect(fixture.entries.map((e) => e.id)).toEqual(GOLDEN_OPTIMIZATION_CASES.map((c) => c.id));
  });

  it.each(GOLDEN_OPTIMIZATION_CASES.map((c) => [c.id] as const))(
    "%s matches its recorded golden result",
    (id) => {
      const testCase = GOLDEN_OPTIMIZATION_CASES.find((c) => c.id === id)!;
      const golden = fixture.entries.find((e) => e.id === id);
      expect(golden, `no recorded entry for ${id}`).toBeTruthy();

      const outcome = once(id);

      // Exact, deliberately. These are integers and enum-like strings from deterministic
      // arithmetic on a fixed problem; there is no tolerance to apply to them, and a change
      // in any of the four is precisely what this store exists to surface.
      expect(outcome.status).toBe(golden!.status);
      expect(outcome.converged).toBe(golden!.converged);
      expect(outcome.iterations).toBe(golden!.iterations);
      expect(outcome.evaluations).toBe(golden!.evaluations);

      expect(outcome.solution).toHaveLength(golden!.solution.length);
      expect(testCase.solutionTolerance).toHaveLength(golden!.solution.length);
      for (let i = 0; i < outcome.solution.length; i++) {
        expect(Math.abs(outcome.solution[i]! - golden!.solution[i]!)).toBeLessThanOrEqual(
          testCase.solutionTolerance[i]!,
        );
      }
      expect(Math.abs(outcome.objective - golden!.objective)).toBeLessThanOrEqual(
        testCase.objectiveTolerance,
      );
    },
  );

  it.each(GOLDEN_OPTIMIZATION_CASES.map((c) => [c.id] as const))(
    "%s is deterministic: two runs in one process agree bit for bit",
    (id) => {
      // The comparison above is against a recorded file and so cannot tell a solver that
      // drifted from one that was never deterministic to begin with. This can. Bit-exact
      // rather than within tolerance: the same code on the same input in the same process
      // has no licence to differ at all.
      const second = runGoldenOptimization(id);
      expect(second).toStrictEqual(once(id));
    },
  );

  it("every case declares one solution tolerance per solution component", () => {
    // A missing entry would make the loop above silently skip a component, so the store's
    // shape is checked rather than assumed.
    for (const testCase of GOLDEN_OPTIMIZATION_CASES) {
      const entry = fixture.entries.find((e) => e.id === testCase.id)!;
      expect(testCase.solutionTolerance).toHaveLength(entry.solution.length);
      for (const tolerance of testCase.solutionTolerance) {
        expect(tolerance).toBeGreaterThan(0);
      }
      expect(testCase.objectiveTolerance).toBeGreaterThan(0);
    }
  });

  it("every case says what it covers", () => {
    // The store is only worth its runtime if each entry fails for a nameable reason.
    for (const testCase of GOLDEN_OPTIMIZATION_CASES) {
      expect(testCase.covers.length).toBeGreaterThan(40);
    }
  });
});

/**
 * Two of the recorded cases have closed forms, and checking them here is what stops this store
 * from being self-referential. A fixture can only ever prove that today's answer equals the day
 * it was recorded; these two prove the recorded answer was right in the first place, so a
 * regression that was baked in at record time cannot hide behind a matching hash.
 */
describe("golden optimization results agree with the analytic answers where they exist (P5.25)", () => {
  it("drag-free maximum range is at pi/4, and equals v^2/g there", () => {
    const outcome = once("maximize-range-drag-free");
    // Vacuum ballistics from a ground launch: theta* = pi/4 and R* = v0^2 / g.
    expect(outcome.solution[0]!).toBeCloseTo(Math.PI / 4, 10);
    expect(outcome.objective).toBeCloseTo(60 ** 2 / G_STD, 8);
  });

  it("drag shifts the optimal elevation below pi/4", () => {
    const dragFree = once("maximize-range-drag-free");
    const withDrag = once("maximize-range-quadratic-drag");
    // The direction of the shift is the physics; its size is what the fixture pins.
    expect(withDrag.solution[0]!).toBeLessThan(dragFree.solution[0]!);
    expect(withDrag.objective).toBeLessThan(dragFree.objective);
  });

  it("the drag-free minimum launch speed to reach range R is sqrt(g*R), at pi/4", () => {
    const outcome = once("min-energy-drag-free-point");
    // The minimum-energy (tangency) solution for a level shot of range R.
    expect(outcome.solution[0]!).toBeCloseTo(Math.sqrt(G_STD * 150), 9);
    expect(outcome.solution[1]!).toBeCloseTo(Math.PI / 4, 8);
  });

  it("every converged shooting case actually drives its miss to the solver's tolerance", () => {
    // Independent of the fixture: a converged Newton solve claims a miss below 1e-6 m, so the
    // recorded merit must honour that claim. This is what would catch a `converged` flag that
    // started being set without the residual test passing.
    for (const testCase of GOLDEN_OPTIMIZATION_CASES) {
      if (!testCase.id.startsWith("newton-")) continue;
      const outcome = once(testCase.id);
      if (outcome.converged) {
        expect(outcome.objective).toBeLessThanOrEqual(1e-6);
      } else {
        // And a non-converged one must not be quietly sitting at a converged miss.
        expect(outcome.objective).toBeGreaterThan(1e-6);
      }
    }
  });
});
