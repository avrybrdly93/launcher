import {
  PRESET_SCENARIOS,
  uncertainScenarioSpecSchema,
  type ScenarioSpec,
  type UncertainScenarioSpec,
} from "@ballista/engine";
import { assembleMcColumns, hashMcStats, mcStats, type McStats } from "@ballista/analysis";
import { createMcColumns, runMcRange, type McColumns } from "./mc-job.js";

/**
 * Golden Monte Carlo results for three studies (P6.28, blueprint §8.4).
 *
 * **What this pins that nothing else does.** `mc-study-reproducibility.test.ts`
 * (P6.27) proves a study is *self-consistent*: the same study run twice, or
 * split across different pool sizes, produces the same hash. That catches
 * nondeterminism and nothing else — a change that moved every replicate's
 * trajectory by the same amount would keep every one of its assertions green,
 * because it compares the run against itself. This file compares the run
 * against a **recorded** answer, which is the only way an *intended* numerical
 * change becomes visible as a diff a human has to narrate. P6.27's own header
 * says so and defers the pinned constant here.
 *
 * **Why this lives in `runtime` and not in `validation` beside the other two
 * golden stores.** `.dependency-cruiser.cjs` allows `validation` to import
 * `engine`, `solverkit` and `analysis` only. The MC job — `runMcRange`,
 * `createMcColumns` — is in `runtime`, one layer above. Moving the store into
 * `validation` would mean widening a layering rule to accommodate a test,
 * which is the wrong way round; the store goes where its subject already is.
 *
 * **Same platform the requirement is bit-equality, not a tolerance.** §8.4
 * asks for "bit-exact on same platform" and a documented 1e-13 relative
 * tolerance cross-platform. The two are not interchangeable and the test
 * treats them separately: on this machine every recorded field must match
 * exactly, because a reduction-order regression would otherwise pass as
 * rounding. {@link MC_STATS_CROSS_PLATFORM_REL_TOL} exists only for the
 * comparison this suite cannot make — against a run on a different engine —
 * and P6.27 built `mcStatsRelativeDrift` for it.
 *
 * **The store deliberately carries no per-case tolerances.** The optimization
 * store needs them because a converged aim is only defined to the criterion
 * that stopped the iteration. Here there is nothing to widen: the recorded
 * quantity is a deterministic function of a fixed seed, so the honest
 * comparison is equality, and a case that could not meet it would be
 * reporting a real defect.
 */

/** The number of replicates every study runs. */
const REPLICATES = 96;

/**
 * Ground level, so a drag-free replicate's observables satisfy exact closed
 * forms. `mc-job.test.ts` lowers the same preset for the same reason.
 */
function atGroundLevel(spec: ScenarioSpec): ScenarioSpec {
  return { ...spec, initialConditions: { ...spec.initialConditions, x0: 0, y0: 0 } };
}

function preset(predicate: (s: ScenarioSpec) => boolean, what: string): ScenarioSpec {
  const found = PRESET_SCENARIOS.find(predicate);
  if (!found) throw new Error(`No preset scenario matching ${what}`);
  return found;
}

/** Gravity only: the one study whose answers can be checked against algebra. */
const DRAG_FREE = atGroundLevel(
  preset((s) => s.model.forceIds.length === 1, "a single-force (drag-free) preset"),
);

/** The most force terms of any preset — gravity, quadratic drag and Magnus. */
const MOST_FORCES = preset(
  (s) => s.model.forceIds.length === 3,
  "a three-force (drag + Magnus) preset",
);

/** A raised release with quadratic drag, and a projectile heavy enough that mass matters. */
const RAISED_RELEASE = preset(
  (s) => s.initialConditions.y0 > 1 && s.model.forceIds.includes("drag-quadratic"),
  "a raised-release preset with quadratic drag",
);

/** What one recorded study reports. Every field is an output; nothing here is a setting. */
export interface GoldenMcOutcome {
  /** SHA-256 over the reduced statistics, as {@link hashMcStats} produces it. */
  readonly hash: string;
  /** The full reduction, recorded rather than only hashed — see the note on {@link GOLDEN_MC_CASES}. */
  readonly stats: McStats;
}

/** One recorded study: the spec it runs, and why it is in the store. */
export interface GoldenMcCase {
  readonly id: string;
  /** What this case would catch that the others would not. */
  readonly covers: string;
  readonly study: UncertainScenarioSpec;
}

/**
 * The three studies, in record order.
 *
 * **Both the hash and the full statistics are recorded, which §8.4 asks for
 * ("hashes + full arrays for the small set") and which is worth the file
 * size.** A hash alone answers "did anything move?" and is useless at saying
 * *what* moved: every field folds into the same 64 hex characters, so a
 * changed variance and a changed `landedCount` produce equally opaque
 * failures. With the statistics recorded, the diff a maintainer reads names
 * the observable and the field. The hash is still pinned separately, because
 * it is what P6.27's chain actually produces and a mismatch between the two
 * would itself be a finding.
 */
export const GOLDEN_MC_CASES: readonly GoldenMcCase[] = [
  {
    id: "drag-free-velocity-spread",
    covers:
      "Gravity alone, launched from the ground, with both velocity components uncertain. " +
      "**The only case whose answer can be checked without reference to this store**, and " +
      "that is why it is first: a drag-free ground-to-ground flight satisfies exact " +
      "identities among its own observables, so the test below verifies the recorded numbers " +
      "were right when they were recorded rather than merely unchanged since. Without it the " +
      "store could pin a regression baked in at record time and never notice.",
    study: uncertainScenarioSpecSchema.parse({
      schemaVersion: 1,
      base: DRAG_FREE,
      overlays: [
        {
          path: "initialConditions.vx0",
          distribution: {
            kind: "normal",
            mean: DRAG_FREE.initialConditions.vx0,
            stdDev: 2,
          },
        },
        {
          path: "initialConditions.vy0",
          distribution: {
            kind: "normal",
            mean: DRAG_FREE.initialConditions.vy0,
            stdDev: 2,
          },
        },
      ],
      replicates: REPLICATES,
      seed: 20260904,
    }),
  },
  {
    id: "magnus-drive-velocity-spread",
    covers:
      "The preset with the most force terms — gravity, quadratic drag and Magnus — so this " +
      "case exercises the longest right-hand side in the library, including the spin-dependent " +
      "lift term no other case here reaches. A golden is worth as much as the arithmetic it " +
      "covers, and a change to the Magnus coefficient or to the drag curve moves this study " +
      "and neither of the others.",
    study: uncertainScenarioSpecSchema.parse({
      schemaVersion: 1,
      base: MOST_FORCES,
      overlays: [
        {
          path: "initialConditions.vx0",
          distribution: {
            kind: "normal",
            mean: MOST_FORCES.initialConditions.vx0,
            stdDev: 3,
          },
        },
        {
          path: "initialConditions.vy0",
          distribution: {
            kind: "normal",
            mean: MOST_FORCES.initialConditions.vy0,
            stdDev: 1.5,
          },
        },
      ],
      replicates: REPLICATES,
      seed: 20260905,
    }),
  },
  {
    id: "raised-release-mass-lognormal",
    covers:
      "**Parameter uncertainty rather than initial-condition uncertainty**, which is a " +
      "different path through the replicate generator: the drawn value lands in " +
      "`projectile.mass`, so it reaches the force evaluation through the projectile " +
      "parameters instead of through the initial state vector. It is also the only case " +
      "drawing from a **lognormal** — the right family for a positive quantity, and a second " +
      "distribution implementation — and the only one released from above the ground, so the " +
      "impact event fires on a trajectory that never returns to its launch height.",
    study: uncertainScenarioSpecSchema.parse({
      schemaVersion: 1,
      base: RAISED_RELEASE,
      overlays: [
        {
          path: "projectile.mass",
          // exp(logMean) is the median; a 5% log standard deviation is a plausible
          // manufacturing spread and keeps every draw comfortably positive.
          distribution: {
            kind: "lognormal",
            logMean: Math.log(RAISED_RELEASE.projectile.mass),
            logStdDev: 0.05,
          },
        },
      ],
      replicates: REPLICATES,
      seed: 20260906,
    }),
  },
];

/** Every case id, in record order. */
export const GOLDEN_MC_IDS: readonly string[] = GOLDEN_MC_CASES.map((c) => c.id);

/**
 * Runs one study end to end and returns its columns, statistics and hash.
 *
 * Deliberately the same chain P6.27 grades — `runMcRange` into chunk-local
 * buffers, `assembleMcColumns` at the global index, `mcStats`, `hashMcStats` —
 * rather than a shortcut, so that what is pinned here is what that test proves
 * reproducible. A single chunk covering the whole study: pool-size invariance
 * is P6.27's subject and repeating it here would pin the same property twice.
 */
export function runGoldenMcStudy(id: string): GoldenMcOutcome & { readonly columns: McColumns } {
  const found = GOLDEN_MC_CASES.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Unknown golden MC case: ${id}`);
  }
  const columns = createMcColumns(REPLICATES);
  runMcRange({ study: found.study }, 0, REPLICATES, columns);
  const assembled = assembleMcColumns(
    [{ startIndex: 0, endIndex: REPLICATES, columns }],
    REPLICATES,
  ) as McColumns;
  const stats = mcStats(assembled);
  return { hash: hashMcStats(stats), stats, columns: assembled };
}

/** The replicate count every recorded study uses, exported so the test can assert against it. */
export const GOLDEN_MC_REPLICATES = REPLICATES;
