/**
 * A single-precision-faithful classical RK4 over the planar gravity + quadratic
 * drag model, and its double-precision twin (P7.14).
 *
 * ## Why this exists: "CPU f32 mode" did not name one thing
 *
 * P7.14's validation line is *"1e4 trajectories match CPU f32 mode within 1e-4
 * rel"*. The 95th, 96th and 97th runs each flagged that phrase, and the 97th
 * handed it forward as **"decide and write down which one the criterion means
 * before measuring against it"**. This module is that decision, made executable.
 *
 * There are two different objects the phrase can denote and the repository
 * already contains the first:
 *
 * 1. **Storage-rounded f32** -- `SolverConfig.precision = "float32"` (P2.21,
 *    ADR-014, blueprint §4.7). `integrate.ts` implements it as `roundToFloat32`,
 *    a `Math.fround` sweep over the **accepted state between steps**. Every RK4
 *    intermediate stage, and every operation inside the rhs, is still computed
 *    in f64; only the state handed to the next step has lost its bits below
 *    `eps32`. Its purpose is the §4.7 exhibit -- it makes the rounding branch of
 *    the V-curve rise sooner -- and for that purpose it is exactly right.
 *
 * 2. **True f32** -- every arithmetic operation rounds to single precision, as
 *    a WGSL kernel declaring `f32` does. The stage values round, the rhs
 *    intermediates round, the drag coefficient product rounds, the square root
 *    rounds.
 *
 * **A GPU kernel is the second and the existing mode is the first, so P7.14's
 * criterion as written compares two things that differ by construction before
 * any tolerance is applied.** The gap is not the GPU's error. `scripts/
 * measure-f32-precision-modes.mjs` measures how large it actually is;
 * `planar-rk4-precision-reference.test.ts` pins the qualitative facts.
 *
 * This module does **not** change `integrate.ts` or the meaning of
 * `SolverConfig.precision`. Mode 1 is not wrong, it is answering a different
 * question, and P2.21's V-curve exhibit depends on it staying as it is.
 *
 * ## One implementation, two precisions, so the comparison isolates rounding
 *
 * Both precisions run the **same function** with a different {@link RoundFn}:
 * `Math.fround` for f32, {@link identity} for f64. Writing two implementations
 * would have allowed an association difference to masquerade as a precision
 * difference -- the one confound this comparison exists to exclude. With one
 * body, the operation order is identical by construction and the only variable
 * left is where the result of each operation is rounded.
 *
 * ## `Math.fround` around an f64 operation really is the f32 operation
 *
 * This is load bearing and it is not obvious, so it is stated rather than
 * assumed, and `planar-rk4-precision-reference.test.ts` checks it against
 * `Math.f16round`-style exhaustive reasoning on small cases.
 *
 * Double rounding -- computing in f64 and then rounding to f32 -- can in
 * general differ from computing in f32 directly. It does not here, for either
 * reason below, for every operation this module performs:
 *
 * - `+`, `-`, `*` on two binary32 values are **exact** in binary64. Two 24-bit
 *   significands multiply to at most 48 bits and f64 carries 53; a sum or
 *   difference of two binary32 values likewise fits. An exact intermediate
 *   rounded once is correctly rounded, so there is no double rounding at all.
 * - `/` and `sqrt` are not exact in f64, so they do double-round -- but they
 *   are safe, because binary64 carries 53 bits and the classical bound for
 *   safe double rounding of a binary32 result needs only `2 * 24 + 2 = 50`.
 *
 * So `fround(a op b)` for binary32 `a`, `b` is the correctly-rounded binary32
 * result of `a op b`, which is what WGSL's `f32` arithmetic is required to
 * produce for `+ - * /` and `sqrt`. **Inputs must already be binary32 for the
 * argument to hold**, which is why {@link initPlanarStateF32} exists and why
 * every parameter is rounded once on entry rather than per use.
 *
 * ## The operation order is this repository's, not a fresh RK4
 *
 * `batched-ensemble-kernel.ts` and `wasm-core/crate/src/lib.rs` document the
 * same three rules, and this module reproduces them so that a disagreement it
 * reports is precision rather than association:
 *
 * - a stage value is `y[i]`, then `+= h * a_ij * k_j[i]` term by term,
 *   left-to-right, with the **zero `a` entries multiplied rather than skipped**;
 * - the combine forms the whole weighted sum first and multiplies by `h` once,
 *   `y[i] + h * (Σ_s b_s k_s[i])`;
 * - the stage time is `t + c_s * h`, and drag's factor is
 *   `(((0.5 * rho) * cd) * area) * speedRel`, left-associated verbatim.
 *
 * `norm` is `sqrt(a0*a0 + a1*a1)` and deliberately **not** `Math.hypot`, which
 * is correctly rounded over the whole expression and would therefore disagree
 * with both the WASM kernel and a WGSL kernel.
 *
 * ## What this module is not
 *
 * It is not a {@link Stepper} and does not participate in the `integrate.ts`
 * driver. It is a closed-form reference for one model at one tableau, whose
 * only job is to be the thing a GPU kernel is compared against. Making it
 * general would reintroduce the dynamic dispatch that a GPU kernel cannot have
 * and would put allocation in its hot path.
 */

/** Rounds a freshly computed f64 result to the working precision. */
export type RoundFn = (x: number) => number;

/** The f64 {@link RoundFn}: results are kept at full double precision. */
export const identity: RoundFn = (x) => x;

/** The f32 {@link RoundFn}. See the note on double rounding above. */
export const toF32: RoundFn = Math.fround;

/** State channel indices for the planar model, `[x, y, vx, vy]`. */
export const X = 0;
export const Y = 1;
export const VX = 2;
export const VY = 3;

/** State dimension, matching `PLANAR_CHANNELS` and the WASM kernel's `DIM`. */
export const DIM = 4;

/** Number of RK4 stages. */
export const STAGES = 4;

/**
 * Parameters of the planar gravity + quadratic-drag model, in the same order
 * and with the same meanings as `wasm-core`'s `ParamSlot`.
 */
export interface PlanarDragParams {
  /** Projectile mass, kg. */
  readonly mass: number;
  /** Reference area, m^2. */
  readonly area: number;
  /** Drag coefficient (constant; this reference targets `ConstantCd`). */
  readonly cd: number;
  /** Air density, kg/m^3 (`ConstantAtmosphere`). */
  readonly rho: number;
  /** Gravitational acceleration, m/s^2 (`UniformGravity`). */
  readonly g: number;
  /** Wind x-component, m/s (`UniformWind`; `ZeroWind` is this at 0). */
  readonly windX: number;
  /** Wind y-component, m/s. */
  readonly windY: number;
}

/**
 * Rounds every parameter to binary32 once, so the double-rounding argument in
 * this module's header holds for every operation that consumes them.
 *
 * Applying `round` per use instead would be equivalent for `Math.fround` (it is
 * idempotent) but would obscure the invariant the argument depends on: by the
 * time arithmetic starts, every input is already representable.
 */
export function roundParams(p: PlanarDragParams, round: RoundFn): PlanarDragParams {
  return {
    mass: round(p.mass),
    area: round(p.area),
    cd: round(p.cd),
    rho: round(p.rho),
    g: round(p.g),
    windX: round(p.windX),
    windY: round(p.windY),
  };
}

/**
 * Builds an initial state whose channels are already binary32, for the same
 * reason {@link roundParams} exists.
 */
export function initPlanarStateF32(y0: ArrayLike<number>): Float64Array {
  const y = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) y[i] = Math.fround(y0[i]!);
  return y;
}

/**
 * The planar rhs, transcribed operation-for-operation from `wasm-core`'s
 * `rhs` with a rounding step after each arithmetic operation.
 *
 * `t` is threaded for shape only -- this model is autonomous -- exactly as the
 * WASM kernel documents.
 */
export function planarDragRhs(
  _t: number,
  y: Float64Array,
  out: Float64Array,
  p: PlanarDragParams,
  round: RoundFn,
): void {
  const vx = y[VX]!;
  const vy = y[VY]!;

  // ctx.vRel = v - w; ctx.speedRel = norm(vRel).
  const vRelX = round(vx - p.windX);
  const vRelY = round(vy - p.windY);
  const speedRel = round(Math.sqrt(round(round(vRelX * vRelX) + round(vRelY * vRelY))));

  // GravityForce::accumulate. Unary minus binds tighter than `*`, so this is
  // `(-mass) * g`, as in the TypeScript and the Rust.
  let f0 = 0;
  let f1 = round(-p.mass * p.g);

  // QuadraticDragForce::accumulate, left-associated verbatim:
  // (((0.5 * rho) * cd) * area) * speedRel.
  const k = round(round(round(round(0.5 * p.rho) * p.cd) * p.area) * speedRel);
  f0 = round(f0 + round(-k * vRelX));
  f1 = round(f1 + round(-k * vRelY));

  out[X] = vx;
  out[Y] = vy;
  out[VX] = round(f0 / p.mass);
  out[VY] = round(f1 / p.mass);
}

/**
 * Preallocated scratch for {@link stepPlanarRk4}. The blueprint's "the hot path
 * allocates nothing" invariant (§5.1) applies here as much as anywhere: a
 * 1e4-trajectory sweep calls the stepper millions of times.
 */
export interface PlanarRk4Scratch {
  readonly k: readonly Float64Array[];
  readonly stage: Float64Array;
}

/** Allocates the per-solve scratch {@link stepPlanarRk4} needs. */
export function createPlanarRk4Scratch(): PlanarRk4Scratch {
  return {
    k: Array.from({ length: STAGES }, () => new Float64Array(DIM)),
    stage: new Float64Array(DIM),
  };
}

/** The classical RK4 tableau, byte-for-byte the values in `RK4_TABLEAU`. */
const C = [0, 0.5, 0.5, 1] as const;
const A: readonly (readonly number[])[] = [[], [0.5], [0, 0.5], [0, 0, 1]];
const B = [1 / 6, 1 / 3, 1 / 3, 1 / 6] as const;

/**
 * One classical RK4 step at the given working precision.
 *
 * The zero `a` entries are multiplied rather than skipped, per the operation
 * order this repository fixed: adding `±0.0` to a finite accumulator is exact
 * and so cannot change a finite result, but reproducing the loop as written
 * costs nothing and removes the question.
 */
export function stepPlanarRk4(
  t: number,
  y: Float64Array,
  h: number,
  p: PlanarDragParams,
  round: RoundFn,
  scratch: PlanarRk4Scratch,
  out: Float64Array,
): void {
  const { k, stage } = scratch;

  for (let s = 0; s < STAGES; s++) {
    if (s === 0) {
      for (let i = 0; i < DIM; i++) stage[i] = y[i]!;
    } else {
      const row = A[s]!;
      for (let i = 0; i < DIM; i++) {
        let acc = y[i]!;
        for (let j = 0; j < row.length; j++) {
          // `h * a * k` is `(h * a) * k`, left-associated.
          acc = round(acc + round(round(h * row[j]!) * k[j]![i]!));
        }
        stage[i] = acc;
      }
    }
    planarDragRhs(round(t + round(C[s]! * h)), stage, k[s]!, p, round);
  }

  // The combine sums over stages first and multiplies by `h` once:
  // `y[i] + h * (Σ_s b_s k_s[i])`, never a running `(y + h*b0*k0) + h*b1*k1`.
  for (let i = 0; i < DIM; i++) {
    let weighted = 0;
    for (let s = 0; s < STAGES; s++) {
      weighted = round(weighted + round(B[s]! * k[s]![i]!));
    }
    out[i] = round(y[i]! + round(h * weighted));
  }
}

/** Options for {@link integratePlanarRk4}. */
export interface PlanarRk4Options {
  /** Initial state `[x, y, vx, vy]`. */
  readonly y0: ArrayLike<number>;
  /** Fixed step size. */
  readonly h: number;
  /** Number of steps to take. */
  readonly steps: number;
  /** Model parameters. */
  readonly params: PlanarDragParams;
  /** Working precision. */
  readonly round: RoundFn;
  /** Start time; defaults to 0. */
  readonly t0?: number;
  /**
   * Called after every accepted step with the step index (1-based), the time,
   * and the state. The array is reused between calls -- copy it to retain it.
   */
  readonly onStep?: (step: number, t: number, y: Float64Array) => void;
}

/**
 * Fixed-step RK4 over `steps` steps at the given working precision.
 *
 * Rounds `h`, `t0`, `y0` and the parameters once on entry so that every
 * subsequent operation has binary32 inputs when `round` is {@link toF32} --
 * the precondition this module's double-rounding argument needs.
 *
 * Returns the final state. `onStep` is how a caller observes the flight; there
 * is no history array, because a 1e4-trajectory sweep must not allocate one per
 * trajectory.
 */
export function integratePlanarRk4(options: PlanarRk4Options): Float64Array {
  const { steps, round, onStep } = options;
  const h = round(options.h);
  const p = roundParams(options.params, round);
  const scratch = createPlanarRk4Scratch();

  const t0 = round(options.t0 ?? 0);
  let current = new Float64Array(DIM);
  let next = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) current[i] = round(options.y0[i]!);

  for (let n = 0; n < steps; n++) {
    // `t0 + n * h`, matching how `runTsEnsembleRange` drives
    // `ClassicalRK4Stepper`, rather than a running `t += h`. The two round
    // differently in f32. It makes no numerical difference for this model --
    // the planar rhs is autonomous and ignores `t` entirely -- but matching the
    // existing driver means the f64 path can be asserted bit-identical to it
    // without a caveat, and a future non-autonomous model inherits the right
    // convention rather than a second one.
    stepPlanarRk4(round(t0 + round(n * h)), current, h, p, round, scratch, next);
    const swap = current;
    current = next;
    next = swap;
    onStep?.(n + 1, round(t0 + round((n + 1) * h)), current);
  }

  return current;
}
