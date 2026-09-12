/**
 * The backend-equivalence golden (P7.11): one fixed ensemble job, its
 * observables frozen in a committed artifact, and the hashes that say which
 * kernel sources those observables belong to.
 *
 * **Why a golden at all, when P7.10 already compares the backends.**
 * `heterogeneous-executor.test.ts` runs one job across TypeScript and both
 * WASM artifacts and requires bit-identity. That is a *relative* check: it
 * proves the backends agree, and it stays green if they stop agreeing with
 * yesterday. A physics edit mirrored into the Rust, or a defect in
 * `lowerEnsembleRange` that both sides read the same way, moves both backends
 * together and no test in the tree sees it. This file is the third point --
 * a frozen reference neither backend can move.
 *
 * **The tolerance is 0 ULP, because the criterion's own instrument is not
 * stable on this model.** P7.11's validation line reads "max rel. diff <
 * 1e-12". That is {@link BLUEPRINT_RELATIVE_TOLERANCE} and it is documented
 * rather than asserted.
 *
 * The reason is measured in `backend-equivalence.test.ts`'s closing study and
 * is stronger than "the number is too big". Swept across step counts, the
 * reassociated-RK4 defect -- `explicit-rk-kernel.ts`'s own documented hazard
 * and P7.07's actual defect -- reads ~3.7e-16 at 1 step, ~1.7e-14 at 300 and
 * ~1.5e-12 at 400: erratic, non-monotonic, and straddling 1e-12. Meanwhile
 * the max *absolute* difference barely moves (~7.7e-13 to ~8.5e-13). What
 * changes is the denominator -- at 400 steps the worst slot is the `vy` of a
 * replicate near its apex, magnitude 2.98e-2. **A relative tolerance divides
 * by a quantity this model drives through zero**, so it reports how near some
 * replicate happened to be to apex rather than how wrong the code is.
 *
 * Bit-identity has no such dependence and catches the defect at every step
 * count swept, so the assertion is {@link ASSERTED_TOLERANCE_ULP} = 0 under
 * `Object.is`. P7.07 reached the same conclusion at 1e-15 on the narrower
 * ground that the figure was too small to matter.
 *
 * **What the hashes do, and the one thing they do not.** CI has no Rust, so
 * `wasm-artifact-freshness.test.ts`'s byte-identity checks skip there, and the
 * 94th run named the consequence: a stale `.wasm` would be compared against
 * goldens generated from source that no longer exists. The golden therefore
 * records the sha256 of both committed artifacts *and* of the crate's own
 * sources. Editing the crate without rebuilding and re-recording goes red
 * **without a toolchain**. What this does *not* do is prove the artifact was
 * compiled from that source -- only a compiler can, and the freshness suite
 * remains the thing that does it wherever one exists. The hashes pin
 * *coherence* between crate, artifact and golden; they do not pin provenance.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WASM_ARTIFACT_PATH, WASM_SIMD_ARTIFACT_PATH } from "@ballista/wasm-core";
import {
  ENSEMBLE_OBS_COUNT,
  runTsEnsembleRange,
  type EnsembleJobSpec,
  type EnsembleReplicate,
} from "./ensemble-job.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the committed golden lives. */
export const GOLDEN_PATH = join(HERE, "backend-equivalence-golden.json");

/**
 * The crate files whose contents decide what the artifacts should be.
 *
 * `Cargo.lock` is in the list on purpose even though the crate has no
 * dependencies: it pins that fact, so acquiring one is a change the golden
 * notices rather than absorbs.
 */
export const CRATE_SOURCE_FILES = ["Cargo.toml", "Cargo.lock", "src/lib.rs"] as const;

const CRATE_DIR = join(HERE, "../../wasm-core/crate");

/**
 * P7.11's validation line, recorded because the task asks for it to be
 * documented. It is **not** what the suite asserts -- see the module header.
 */
export const BLUEPRINT_RELATIVE_TOLERANCE = 1e-12;

/** What the suite actually asserts: bit-identity. */
export const ASSERTED_TOLERANCE_ULP = 0;

/**
 * The fixture, chosen so that each of the failure modes earlier runs actually
 * found would be visible here.
 *
 * - `REPLICATE_COUNT` is **odd**, so `batch_run_simd`'s scalar tail is on the
 *   recorded path rather than beside it (P7.09).
 * - `H` is **not a power of two**. A dyadic step makes `t0 + i*h` accumulated
 *   and `t0 + i*h` multiplied the same double, and a `t_final` control would
 *   pass a broken backend (P7.10, control B).
 * - Replicates vary mass, radius, drag coefficient and all four initial state
 *   components, and `vy0` spans rising and falling, so the running-max branch
 *   fires for some replicates and not others. A homogeneous ensemble is
 *   bit-identical under a lane swap, which is P7.09's characteristic defect;
 *   `backend-equivalence.test.ts` asserts every adjacent pair genuinely
 *   differs before it trusts any equality.
 */
export const REPLICATE_COUNT = 65;
export const STEPS = 400;
export const T0 = 0.25;
export const H = 0.0071;

/**
 * Deterministic replicate generation.
 *
 * A 32-bit LCG rather than `Math.random`, because a golden recorded from an
 * unseeded source cannot be re-derived. The constants are Numerical Recipes'
 * `ranqd1`; the quality bar here is "spread out and reproducible", not
 * statistical -- these are fixture parameters, not a Monte Carlo draw.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Builds the fixture's replicates. Pure and seeded, so this is the definition. */
export function goldenReplicates(): EnsembleReplicate[] {
  const rand = lcg(20260912);
  const replicates: EnsembleReplicate[] = [];
  for (let i = 0; i < REPLICATE_COUNT; i++) {
    replicates.push({
      mass: 0.2 + rand() * 4.8,
      radius: 0.02 + rand() * 0.08,
      dragCoefficient: 0.1 + rand() * 0.8,
      x0: rand() * 5,
      y0: 1 + rand() * 40,
      vx0: 10 + rand() * 90,
      // Spans +60 to -60: some replicates are still climbing at t0 and some
      // are already falling, so `maxSampledHeight`'s branch is exercised in
      // both directions. P7.09 found a benchmark whose ensemble claimed this
      // and did not have it.
      vy0: 60 - rand() * 120,
    });
  }
  return replicates;
}

/** The fixture job. One definition, used by the recorder and by the suite. */
export function goldenJob(): EnsembleJobSpec {
  return {
    t0: T0,
    h: H,
    steps: STEPS,
    gravity: 9.80665,
    windX: -3.5,
    windY: 1.25,
    replicates: goldenReplicates(),
  };
}

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/** sha256 of one committed artifact's bytes. */
export function artifactHash(path: string): string {
  return sha256(readFileSync(path));
}

/**
 * sha256 over the crate's sources.
 *
 * Hashed as a manifest of `name:hash` lines rather than as concatenated bytes,
 * so that moving a byte from the end of one file to the start of the next
 * changes the result. Plain concatenation would not.
 */
export function crateSourceHash(): string {
  const manifest = CRATE_SOURCE_FILES.map(
    (name) => `${name}:${sha256(readFileSync(join(CRATE_DIR, name)))}`,
  ).join("\n");
  return sha256(manifest);
}

/**
 * sha256 over an observables block, taken over its **raw bytes** rather than
 * its decimal rendering, so the hash is sensitive to a difference that a
 * rounded print would hide.
 */
export function observablesHash(rows: Float64Array): string {
  return sha256(Buffer.from(rows.buffer, rows.byteOffset, rows.byteLength));
}

/** The committed golden's shape. */
export interface BackendEquivalenceGolden {
  readonly schemaVersion: 1;
  readonly provenance: string;
  readonly criterion: {
    /** P7.11's validation line. Documented, not asserted. */
    readonly blueprintRelativeTolerance: number;
    /** What is asserted instead. */
    readonly assertedToleranceUlp: number;
    /**
     * The measured max relative difference between the TypeScript reference
     * and each WASM artifact at record time. Recorded as a number so
     * "documented" in the validation line is a measurement.
     */
    readonly measuredMaxRelativeDifference: number;
  };
  readonly fixture: {
    readonly replicates: number;
    readonly steps: number;
    readonly t0: number;
    readonly h: number;
    readonly gravity: number;
    readonly windX: number;
    readonly windY: number;
    readonly obsCount: number;
  };
  /**
   * What the observables below belong to. A mismatch means the golden and the
   * kernel have parted company; re-record on a machine with a Rust toolchain
   * so the freshness suite runs in the same breath.
   */
  readonly sources: {
    readonly scalarArtifactSha256: string;
    readonly simdArtifactSha256: string;
    readonly crateSourceSha256: string;
    readonly crateFiles: readonly string[];
  };
  readonly observables: {
    readonly sha256: string;
    /**
     * All `replicates * obsCount` doubles, row-major. Stored in full rather
     * than as a hash alone: a hash says *that* something moved, and a golden
     * whose only failure message is "hash differs" cannot tell the next
     * reader *what* moved or by how much.
     */
    readonly rows: readonly number[];
  };
}

/** Recomputes the golden from the current tree. The recorder's whole body. */
export function recordGolden(): BackendEquivalenceGolden {
  const job = goldenJob();
  const rows = runTsEnsembleRange(job, 0, job.replicates.length);
  return {
    schemaVersion: 1,
    provenance:
      "P7.11. Recorded from runTsEnsembleRange -- the TypeScript reference -- and asserted " +
      "bit-identical to both committed WASM artifacts by backend-equivalence.test.ts. " +
      "Regenerate with `pnpm update:backend-golden`, on a machine with a Rust toolchain so " +
      "wasm-artifact-freshness.test.ts runs rather than skips.",
    criterion: {
      blueprintRelativeTolerance: BLUEPRINT_RELATIVE_TOLERANCE,
      assertedToleranceUlp: ASSERTED_TOLERANCE_ULP,
      measuredMaxRelativeDifference: 0,
    },
    fixture: {
      replicates: REPLICATE_COUNT,
      steps: STEPS,
      t0: T0,
      h: H,
      gravity: job.gravity,
      windX: job.windX,
      windY: job.windY,
      obsCount: ENSEMBLE_OBS_COUNT,
    },
    sources: {
      scalarArtifactSha256: artifactHash(WASM_ARTIFACT_PATH),
      simdArtifactSha256: artifactHash(WASM_SIMD_ARTIFACT_PATH),
      crateSourceSha256: crateSourceHash(),
      crateFiles: [...CRATE_SOURCE_FILES],
    },
    observables: { sha256: observablesHash(rows), rows: [...rows] },
  };
}

/** Reads the committed golden. */
export function readGolden(): BackendEquivalenceGolden {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as BackendEquivalenceGolden;
}

/**
 * Largest relative difference between two observables blocks, and where.
 *
 * Reported alongside the ULP assertion because the validation line asks for a
 * relative figure. `Object.is` is what gates; this is what gets written down.
 * Two identical `NaN`s would compare equal under `Object.is` and produce
 * `NaN` here, which is why `validateEnsembleJob` rejects a degenerate spec
 * before any of this runs.
 */
export function maxRelativeDifference(
  a: Float64Array,
  b: Float64Array,
): { readonly value: number; readonly index: number } {
  if (a.length !== b.length) {
    throw new Error(`maxRelativeDifference: length ${a.length} vs ${b.length}`);
  }
  let worst = 0;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Object.is(x, y)) continue;
    const scale = Math.max(Math.abs(x), Math.abs(y));
    const rel = scale === 0 ? Math.abs(x - y) : Math.abs(x - y) / scale;
    if (rel > worst) {
      worst = rel;
      at = i;
    }
  }
  return { value: worst, index: at };
}

/** Count of slots where two blocks are not bit-identical. */
export function bitMismatchCount(a: Float64Array, b: Float64Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) n++;
  return n;
}
