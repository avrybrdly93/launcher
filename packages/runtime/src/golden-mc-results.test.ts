/**
 * P6.28 — golden Monte Carlo results, pinned for three studies.
 *
 * Blueprint §8.4 is the contract: *"CI recomputes and compares: bit-exact on
 * same platform for the deterministic core; documented tolerance (1e-13
 * relative) cross-platform. Any intentional numerical change requires an
 * explicit `--update-goldens` commit with a changelog entry stating why
 * results moved."*
 *
 * **How this differs from P6.27, which also hashes MC studies.**
 * `mc-study-reproducibility.test.ts` compares a run against *another run of
 * itself* — twice in a process, across pool sizes, across chunk arrival
 * orders. That is the right shape for catching nondeterminism and it is
 * structurally blind to a change that moves every replicate identically:
 * recompute both sides and both sides move together. This file compares
 * against a **recorded** file, which is the only way a deliberate numerical
 * change shows up as a diff someone has to explain. Neither subsumes the
 * other, and P6.27's header says as much.
 *
 * **Same platform is bit-equality, deliberately.** Every recorded field is
 * compared with `Object.is`, and the drift computed by
 * `mcStatsRelativeDrift` must be exactly `0` — not merely under
 * `MC_STATS_CROSS_PLATFORM_REL_TOL`. That constant is for the comparison this
 * suite cannot perform (a second engine) and reaching for it here would let a
 * genuine reduction-order regression pass as rounding. Its own doc comment
 * says a same-platform check must never use it.
 *
 * **Re-recording.** `pnpm run update-goldens`. Never hand-edit the JSON.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { G_STD } from "@ballista/engine";
import {
  MC_STATS_CROSS_PLATFORM_REL_TOL,
  mcStatsRelativeDrift,
  type McObservableStats,
  type McStats,
} from "@ballista/analysis";
import {
  GOLDEN_MC_CASES,
  GOLDEN_MC_REPLICATES,
  runGoldenMcStudy,
  type GoldenMcOutcome,
} from "./golden-mc-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "golden-mc-results.json");

interface GoldenMcEntry extends GoldenMcOutcome {
  readonly id: string;
  /**
   * The study's own identity, recorded alongside its answer so that a change
   * to the *question* is visible in the diff rather than showing up only as a
   * moved hash. §8.4 asks for goldens versioned with schema versions.
   */
  readonly studySchemaVersion: number;
  readonly seed: number;
  readonly replicates: number;
}

interface GoldenMcFixture {
  readonly schemaVersion: 1;
  readonly provenance: string;
  readonly entries: readonly GoldenMcEntry[];
}

const OBSERVABLES = ["range", "apexHeight", "timeOfFlight", "impactSpeed"] as const;
const FIELDS = ["sum", "sumSquares", "min", "max", "mean", "variance"] as const;

/**
 * One run per case, shared by the assertions that only need *an* outcome.
 *
 * Each study integrates 96 trajectories, so re-running per assertion would
 * cost real time in a suite that already runs browser-driven tests in the same
 * pool. Nothing is traded for the saving: the determinism case below performs
 * a genuine second run and compares it against this one.
 */
const firstRun = new Map<string, ReturnType<typeof runGoldenMcStudy>>();

function once(id: string): ReturnType<typeof runGoldenMcStudy> {
  const cached = firstRun.get(id);
  if (cached !== undefined) return cached;
  const outcome = runGoldenMcStudy(id);
  firstRun.set(id, outcome);
  return outcome;
}

function recordFixture(): GoldenMcFixture {
  return {
    schemaVersion: 1,
    provenance:
      "Recorded via `UPDATE_GOLDENS=1 pnpm run update-goldens` (P6.28; blueprint §8.4). Any " +
      "intentional numerical change requires re-running that command with a commit message " +
      "explaining *why* the numbers moved -- never hand-edit this file. Same-platform " +
      "comparison is bit-exact, so there are no tolerances stored here and none to widen; " +
      "the 1e-13 figure in `MC_STATS_CROSS_PLATFORM_REL_TOL` is the cross-engine budget and " +
      "is deliberately not used by this suite.",
    entries: GOLDEN_MC_CASES.map((c) => {
      const { hash, stats } = runGoldenMcStudy(c.id);
      for (const observable of OBSERVABLES) {
        for (const field of FIELDS) {
          const value = stats[observable][field];
          if (!Number.isFinite(value)) {
            // JSON cannot represent NaN or +-Infinity, and every study in the
            // store lands every replicate, so this is unreachable today. If a
            // future study has landedCount < 2, `mean`/`variance` become NaN by
            // design and this file needs an encoding decision before it can
            // record them -- made deliberately, not silently as `null`.
            throw new Error(
              `Cannot record ${c.id}: ${observable}.${field} is ${String(value)}, which JSON ` +
                `cannot represent. Give the fixture a non-finite encoding before adding a ` +
                `study whose landed subset can be empty or a singleton.`,
            );
          }
        }
      }
      return {
        id: c.id,
        studySchemaVersion: c.study.schemaVersion,
        seed: c.study.seed,
        replicates: c.study.replicates,
        hash,
        stats,
      };
    }),
  };
}

function loadFixture(): GoldenMcFixture {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Golden MC fixture missing at ${FIXTURE_PATH}. Run "pnpm run update-goldens" to record it.`,
    );
  }
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GoldenMcFixture;
}

describe("golden MC results (P6.28)", () => {
  if (process.env["UPDATE_GOLDENS"] === "1") {
    it("records a fresh golden fixture (UPDATE_GOLDENS=1)", () => {
      const fixture = recordFixture();
      writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
      expect(fixture.entries).toHaveLength(GOLDEN_MC_CASES.length);
    });
    return;
  }

  const fixture = loadFixture();

  it("the fixture covers every case exactly once, in the store's order", () => {
    expect(fixture.entries.map((e) => e.id)).toEqual(GOLDEN_MC_CASES.map((c) => c.id));
  });

  it("pins three studies, which is what the task asks for", () => {
    // A store that quietly shrank to one case would still pass every
    // comparison below.
    expect(GOLDEN_MC_CASES).toHaveLength(3);
  });

  it.each(GOLDEN_MC_CASES.map((c) => [c.id] as const))(
    "%s still runs the study that was recorded",
    (id) => {
      // Guards the question, not the answer. A silently edited seed, replicate
      // count or schema version would move every number below, and the diff
      // would look like a numerical regression rather than the spec change it
      // is.
      const testCase = GOLDEN_MC_CASES.find((c) => c.id === id)!;
      const golden = fixture.entries.find((e) => e.id === id)!;
      expect(golden.seed).toBe(testCase.study.seed);
      expect(golden.replicates).toBe(testCase.study.replicates);
      expect(golden.studySchemaVersion).toBe(testCase.study.schemaVersion);
      expect(golden.replicates).toBe(GOLDEN_MC_REPLICATES);
    },
  );

  it.each(GOLDEN_MC_CASES.map((c) => [c.id] as const))(
    "%s matches its recorded hash and every recorded statistic, bit for bit",
    (id) => {
      const golden = fixture.entries.find((e) => e.id === id);
      expect(golden, `no recorded entry for ${id}`).toBeTruthy();

      const { hash, stats } = once(id);

      expect(hash).toBe(golden!.hash);
      expect(stats.count).toBe(golden!.stats.count);
      expect(stats.landedCount).toBe(golden!.stats.landedCount);

      // `Object.is` rather than `===` so that a NaN which is supposed to be
      // there matches, and a -0 that became +0 does not silently pass.
      for (const observable of OBSERVABLES) {
        const actual: McObservableStats = stats[observable];
        const recorded: McObservableStats = golden!.stats[observable];
        for (const field of FIELDS) {
          expect(
            Object.is(actual[field], recorded[field]),
            `${id}: ${observable}.${field} is ${actual[field]}, recorded ${recorded[field]}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(GOLDEN_MC_CASES.map((c) => [c.id] as const))(
    "%s has exactly zero drift from its recorded statistics",
    (id) => {
      // The same requirement as above, read through the comparator P6.27 built,
      // which is what a cross-engine check would use. Exactly zero, not "below
      // MC_STATS_CROSS_PLATFORM_REL_TOL": on one platform bit-equality is the
      // requirement, and that constant is documented as never being for this.
      const drift = mcStatsRelativeDrift(
        once(id).stats,
        fixture.entries.find((e) => e.id === id)!.stats,
      );
      expect(drift).toBe(0);
      expect(drift).toBeLessThan(MC_STATS_CROSS_PLATFORM_REL_TOL);
    },
  );

  it.each(GOLDEN_MC_CASES.map((c) => [c.id] as const))(
    "%s is deterministic: two runs in one process agree bit for bit",
    (id) => {
      // The fixture comparison cannot tell a study that drifted from one that
      // was never deterministic to begin with. This can.
      const second = runGoldenMcStudy(id);
      expect(second.hash).toBe(once(id).hash);
      expect(mcStatsRelativeDrift(second.stats, once(id).stats)).toBe(0);
    },
  );

  it.each(GOLDEN_MC_CASES.map((c) => [c.id] as const))(
    "%s pins a study that did real work, so nothing above passes vacuously",
    (id) => {
      // Guards the fixture, not the code. A study where nothing landed, or
      // where every observable collapsed to a constant, would hash stably for
      // the wrong reason and every equality above it would hold trivially.
      const { stats } = once(id);
      expect(stats.count).toBe(GOLDEN_MC_REPLICATES);
      expect(stats.landedCount).toBeGreaterThan(0);
      for (const observable of OBSERVABLES) {
        expect(Number.isFinite(stats[observable].mean)).toBe(true);
        // Strictly positive: an overlay that stopped being applied at all
        // would leave every replicate identical and every variance exactly 0.
        // That is the failure this assertion exists for, and it is the only
        // thing standing behind the third case, whose spread is genuinely
        // small (see below).
        expect(stats[observable].variance).toBeGreaterThan(0);
      }
    },
  );

  it("every case says what it covers", () => {
    for (const testCase of GOLDEN_MC_CASES) {
      expect(testCase.covers.length).toBeGreaterThan(40);
    }
  });

  it("the three studies are genuinely different questions", () => {
    // Three recordings of the same study would satisfy "3 studies" on a count
    // and cover one code path.
    const seeds = new Set(GOLDEN_MC_CASES.map((c) => c.study.seed));
    expect(seeds.size).toBe(3);
    const hashes = new Set(GOLDEN_MC_CASES.map((c) => once(c.id).hash));
    expect(hashes.size).toBe(3);
    const forceSets = new Set(GOLDEN_MC_CASES.map((c) => c.study.base.model.forceIds.join(",")));
    expect(forceSets.size).toBe(3);
    // One case draws a projectile parameter rather than an initial condition,
    // and one draws from a family other than `normal`.
    expect(
      GOLDEN_MC_CASES.some((c) => c.study.overlays.some((o) => o.path.startsWith("projectile."))),
    ).toBe(true);
    expect(
      GOLDEN_MC_CASES.some((c) =>
        c.study.overlays.some((o) => o.distribution.kind === "lognormal"),
      ),
    ).toBe(true);
  });
});

/**
 * The drag-free study's answers are checkable against algebra, and checking
 * them is what stops this store from being self-referential.
 *
 * A fixture can only prove that today's answer equals the day it was recorded.
 * These identities prove the recorded answer was *right* when recorded, so a
 * regression baked in at record time cannot hide behind a matching hash. They
 * use only recorded observables — no draw is re-derived — because for a
 * gravity-only flight launched from and returning to y = 0:
 *
 *     T = 2*vy0/g          =>  vy0 = g*T/2
 *     apex = vy0^2/(2g)    =>  apex = g*T^2/8
 *     vx0 = R/T
 *     |v_impact| = hypot(vx0, vy0)  (energy is conserved, launch height = impact height)
 *
 * Both identities were measured on the recorded study: the worst relative
 * residual over its 96 replicates is 2.1e-15 for the apex and 7.9e-16 for the
 * impact speed. The tolerance below is 1e-12 — three decades of headroom over
 * the measured figure, chosen so the assertion tracks the adaptive stepper's
 * event resolution rather than pinning the exact roundoff of one machine.
 */
describe("the drag-free golden agrees with the closed forms (P6.28)", () => {
  const CLOSED_FORM_REL_TOL = 1e-12;

  it("apex height equals g*T^2/8 for every landed replicate", () => {
    const { columns } = once("drag-free-velocity-spread");
    let worst = 0;
    let checked = 0;
    for (let i = 0; i < columns.landed.length; i++) {
      if (columns.landed[i] !== 1) continue;
      const t = columns.timeOfFlight[i]!;
      const predicted = (G_STD * t * t) / 8;
      worst = Math.max(worst, Math.abs(columns.apexHeight[i]! - predicted) / predicted);
      checked++;
    }
    // Without this the loop could check nothing and still pass.
    expect(checked).toBe(GOLDEN_MC_REPLICATES);
    expect(worst).toBeLessThan(CLOSED_FORM_REL_TOL);
  });

  it("impact speed equals hypot(R/T, g*T/2) for every landed replicate", () => {
    const { columns } = once("drag-free-velocity-spread");
    let worst = 0;
    let checked = 0;
    for (let i = 0; i < columns.landed.length; i++) {
      if (columns.landed[i] !== 1) continue;
      const t = columns.timeOfFlight[i]!;
      const predicted = Math.hypot(columns.range[i]! / t, (G_STD * t) / 2);
      worst = Math.max(worst, Math.abs(columns.impactSpeed[i]! - predicted) / predicted);
      checked++;
    }
    expect(checked).toBe(GOLDEN_MC_REPLICATES);
    expect(worst).toBeLessThan(CLOSED_FORM_REL_TOL);
  });

  it("the drag-bearing studies do NOT satisfy the drag-free identity", () => {
    // The negative control. Without it, the two assertions above would still
    // pass if the identity were an artefact of how the observables are
    // computed rather than a statement about gravity-only flight -- and they
    // would then be checking nothing.
    const { columns } = once("magnus-drive-velocity-spread");
    let worst = 0;
    for (let i = 0; i < columns.landed.length; i++) {
      if (columns.landed[i] !== 1) continue;
      const t = columns.timeOfFlight[i]!;
      const predicted = (G_STD * t * t) / 8;
      worst = Math.max(worst, Math.abs(columns.apexHeight[i]! - predicted) / predicted);
    }
    expect(worst).toBeGreaterThan(0.01);
  });
});
