/**
 * The WGSL observables kernel: one thread integrates one flight and reduces it
 * to apex and range on-device, writing back five floats instead of a trajectory
 * (P7.16).
 *
 * ## What it is for
 *
 * P7.14's kernel writes back the final state, which answers "do the GPU and CPU
 * agree" and nothing an ensemble study asks. A study wants range and apex per
 * trajectory. Getting those by shipping the flight back to the host means the
 * readback dominates: 1e4 flights at 2000 steps is 3.2e8 bytes crossing the bus
 * to produce 1e4 pairs of scalars. Reducing on-device makes it 2e5 bytes.
 *
 * ## The physics is not written here, deliberately
 *
 * `Params`, `Config`, `rhs` and `rk4Step` are interpolated from
 * `wgsl-planar-physics.ts`, the same text P7.14's kernel uses. A second copy
 * would agree on the day it was made and diverge silently afterwards, and the
 * measurement that would catch it -- the agreement check -- only ever compiles
 * the other kernel. See that module for why the extraction is byte-for-byte.
 *
 * So the only new arithmetic below is the reduction: two Hermite helpers and the
 * capture logic. That is the whole surface P7.16 has to justify, and
 * `planar-observables-reduction.ts` is the CPU reference it is a transcription
 * of, operation for operation.
 *
 * ## Divergence-free, which cost real design effort rather than a comment
 *
 * §4.10 picks fixed-step RK4 for ensembles because it gives divergence-free
 * control flow, and a reduction is exactly the kind of addition that quietly
 * destroys that property: "did this thread cross the ground yet" is per-thread
 * state, and the obvious `if` on it makes lanes in a workgroup take different
 * paths.
 *
 * Three things keep it uniform, and all three constrain the CPU reference too,
 * which is why that module is written in this shape despite not needing to be:
 *
 * 1. **Every conditional is `select`, not `if`.** Both roots of the stationary
 *    quadratic are computed; both sides of each bisection bracket are computed;
 *    the apex candidate is computed on every step whether or not the step
 *    brackets a crossing. There is exactly one `if` in the kernel -- the
 *    out-of-range guard at entry, which is uniform within every workgroup except
 *    the last, and which P7.14's kernel has for the same reason.
 *
 * 2. **The impact bisection is hoisted out of the step loop.** Running it on the
 *    crossing step only is the data-dependent branch that is forbidden; running
 *    it on *every* step is 60 Hermite evaluations per step, which costs more
 *    than the integration it observes. Capturing ten floats of bracket and
 *    bisecting once after the loop is uniform and cheap: every thread does
 *    exactly {@link WGSL_IMPACT_BISECTION_STEPS} iterations, once.
 *
 * 3. **No divide or `sqrt` guard relies on a trap.** A negative discriminant and
 *    a zero denominator both produce values that are then masked off by a
 *    `select` whose condition was computed separately -- `disc >= 0.0`,
 *    `a != 0.0`, `q != 0.0`. Nothing depends on WGSL's behaviour for `sqrt` of a
 *    negative, which the specification leaves indeterminate rather than
 *    requiring NaN, and nothing depends on NaN comparison semantics.
 *
 * ## The clock, which is a fidelity detail and not a formality
 *
 * The CPU reference takes each step's `h` as the **difference of two rounded
 * times**, `t_{n+1} - t_n` with `t_n = round(t0 + round(n*h))`, because that is
 * how `integratePlanarRk4` drives `onStep` and how `runTsEnsembleRange` drives
 * the stepper. In binary32 that is not the same number as the configured `h`.
 * The kernel reconstructs the times the same way, from `n` rather than by
 * accumulating `t = t + h`, and takes its step size as their difference.
 * Accumulating would drift, and drift against a reference that does not drift
 * would show up as a reduction disagreement with no reduction bug behind it.
 *
 * `t0` is fixed at zero here. The planar rhs is autonomous so it changes no
 * trajectory, and the reference's default is zero; a kernel taking a launch
 * epoch would have to round it into the uniform and match
 * `round(t0 + round(n*h))` term by term, which is work with no caller asking
 * for it yet.
 *
 * ## What "impacted" is for
 *
 * A flight that never crosses `y = 0` within its step budget has no impact
 * point, and reporting a range for it would be reporting a number for a question
 * that was not asked. The fifth output is `1.0` when a crossing was captured and
 * `0.0` otherwise, and range and impact time are forced to zero in the second
 * case rather than left holding whatever the unrefined bracket produced.
 */

import {
  WGSL_PLANAR_COMPENSATED_STEP_FNS,
  WGSL_PLANAR_STEP_FNS,
  WGSL_PLANAR_STRUCTS,
} from "./wgsl-planar-physics.js";
import { WGSL_STATE_DIM, WGSL_WORKGROUP_SIZE } from "./wgsl-rk4-kernel.js";

/** Options for {@link buildWgslObservablesKernelSource}. */
export interface WgslObservablesKernelOptions {
  /**
   * Use the two-float (compensated) accumulator for the state march (P0.136).
   *
   * Defaults to `false`, matching the CPU arm's own default and, more
   * importantly, keeping the generated text identical to the one P7.16 measured
   * 0-ULP against. Turning it on is a numerical change, not a tuning knob: it
   * is what lets a long flight meet P7.19's 1e-3 m absolute impact bar, which
   * the plain accumulator misses by 15.5x on the drag-free family.
   */
  readonly compensated?: boolean;
}

/**
 * Floats written back per trajectory:
 * `[apexHeight, apexT, range, impactT, impacted]`.
 */
export const WGSL_OBSERVABLE_DIM = 5;

/** Offsets within one trajectory's observable record. */
export const WGSL_OBSERVABLE_OFFSETS = {
  apexHeight: 0,
  apexT: 1,
  range: 2,
  impactT: 3,
  impacted: 4,
} as const;

/**
 * Halvings in the impact bisection, matching `IMPACT_BISECTION_STEPS` in the CPU
 * reference and `heightAtDownrange`'s convention in `observables.ts`.
 *
 * Fixed rather than tolerance-driven, which on the CPU is a nicety and here is
 * the requirement: a tolerance test is a data-dependent trip count.
 */
export const WGSL_IMPACT_BISECTION_STEPS = 60;

/** Binding layout of the observables kernel's one bind group, as data. */
export const WGSL_OBSERVABLE_BINDINGS = {
  /** `array<Params>`, one per trajectory. Read-only storage. */
  params: 0,
  /** `array<f32>`, `WGSL_STATE_DIM` per trajectory. Read-only storage. */
  initialStates: 1,
  /** `array<f32>`, `WGSL_OBSERVABLE_DIM` per trajectory. Written by the kernel. */
  observables: 2,
  /** `Config`: step size, step count, trajectory count. Uniform. */
  config: 3,
} as const;

/** The observables kernel's entry point name. */
export const WGSL_OBSERVABLE_ENTRY_POINT = "main";

/**
 * Builds the observables compute shader with a chosen `@workgroup_size` literal.
 *
 * A builder rather than a constant with a string replace, for the reason
 * `buildWgslRk4KernelSource` gives: the literal appears in the pattern, so a
 * replace silently becomes a no-op the day the default changes, and a no-op
 * there does not fail -- it produces a source whose declared size disagrees with
 * the dispatch geometry, which under-dispatches and leaves the tail of the
 * ensemble holding its initial state.
 *
 * @param workgroupSize positive integer.
 * @param options `compensated` selects the two-float accumulator (P0.136);
 *   it defaults to `false`, and when it is `false` the returned text is
 *   byte-identical to what this builder produced before that option existed.
 * @throws RangeError if `workgroupSize` is not a positive integer.
 */
export function buildWgslObservablesKernelSource(
  workgroupSize: number,
  options: WgslObservablesKernelOptions = {},
): string {
  if (!Number.isInteger(workgroupSize) || workgroupSize <= 0) {
    throw new RangeError(`workgroup size must be a positive integer, got ${workgroupSize}`);
  }
  const compensated = options.compensated ?? false;

  // Every one of these is the empty string in the default mode, which is what
  // keeps that text byte-identical to the pre-P0.136 build. They are separate
  // fragments rather than one branch over two whole sources for the reason the
  // shared-physics docstring gives: two spellings of the march would agree on
  // the day they were written and diverge silently afterwards.
  const compensatedFns = compensated ? `\n\n${WGSL_PLANAR_COMPENSATED_STEP_FNS}` : "";
  const compensationDecl = compensated
    ? `\n  // The residual half of the two-float accumulator, zero-initialised before
  // the first step and carried across every one of them. Per thread, because
  // each trajectory has its own running sum.
  var comp = vec4<f32>(0.0);`
    : "";
  const stepStatement = compensated
    ? `let stepped = rk4StepCompensated(y, comp, h, p);
    let next = stepped.y;`
    : `let next = rk4Step(y, h, p);`;
  const carryStatement = compensated ? `\n    comp = stepped.c;` : "";

  return /* wgsl */ `
${WGSL_PLANAR_STRUCTS}

@group(0) @binding(0) var<storage, read> params: array<Params>;
@group(0) @binding(1) var<storage, read> initialStates: array<f32>;
@group(0) @binding(2) var<storage, read_write> observables: array<f32>;
@group(0) @binding(3) var<uniform> config: Config;

${WGSL_PLANAR_STEP_FNS}${compensatedFns}

// Cubic Hermite value on one channel, operation-for-operation from
// @ballista/analysis's hermiteValue and from hermiteValueAt in the CPU
// reduction. The coefficient groupings are the reference's associations, not a
// tidier equivalent: in f32 a reassociation is a different number.
fn hermiteValue(y0: f32, d0: f32, y1: f32, d1: f32, h: f32, theta: f32) -> f32 {
  let t2 = theta * theta;
  let t3 = t2 * theta;
  let c0 = ((2.0 * t3) - (3.0 * t2)) + 1.0;
  let c1 = (t3 - (2.0 * t2)) + theta;
  let c2 = (-(2.0 * t3)) + (3.0 * t2);
  let c3 = t3 - t2;
  return (((c0 * y0) + ((h * c1) * d0)) + (c2 * y1)) + ((h * c3) * d1);
}

// The theta in [0,1] where the cubic Hermite is stationary, as
// vec2(theta, valid). Returns a pair rather than branching: both roots are
// always computed and selected between, because an early return here is a
// per-thread branch on state.
//
// The sign-stable form q = -(b + sign(b)*sqrt(disc))/2 is the reference's,
// kept because the cancellation the textbook formula suffers when |a| << |b|
// -- a nearly-linear derivative, which a small step produces naturally -- costs
// digits f32 has far fewer of to spare.
//
// Nothing here relies on sqrt(negative) being NaN, which WGSL leaves
// indeterminate: quadOk carries disc >= 0.0 separately, and every use of a
// possibly-garbage value is masked by a select on a condition computed from
// inputs rather than from the garbage.
fn hermiteStationaryTheta(y0: f32, d0: f32, y1: f32, d1: f32, h: f32) -> vec2<f32> {
  let dy = y1 - y0;
  let hd0 = h * d0;
  let hd1 = h * d1;
  let a = 3.0 * ((hd0 + hd1) - (2.0 * dy));
  let b = 2.0 * (((3.0 * dy) - ((2.0 * h) * d0)) - hd1);
  let c = hd0;

  // a == 0: the derivative is genuinely linear and the root is -c/b.
  let linearRoot = (-c) / b;
  let linearOk = (a == 0.0) && (b != 0.0);

  let disc = (b * b) - ((4.0 * a) * c);
  let sqrtDisc = sqrt(disc);
  let signedDisc = select(-sqrtDisc, sqrtDisc, b >= 0.0);
  let q = (-0.5) * (b + signedDisc);
  let root0 = q / a;
  let root1 = c / q;
  let quadOk = (a != 0.0) && (disc >= 0.0);

  let linearInRange = linearOk && (linearRoot >= 0.0) && (linearRoot <= 1.0);
  let root0Ok = quadOk && (root0 >= 0.0) && (root0 <= 1.0);
  let root1Ok = quadOk && (q != 0.0) && (root1 >= 0.0) && (root1 <= 1.0);

  // Applied lowest priority first, so the reference's order -- linear, then
  // q/a, then c/q -- is what survives.
  var theta = 0.0;
  var valid = 0.0;
  theta = select(theta, root1, root1Ok);
  valid = select(valid, 1.0, root1Ok);
  theta = select(theta, root0, root0Ok);
  valid = select(valid, 1.0, root0Ok);
  theta = select(theta, linearRoot, linearInRange);
  valid = select(valid, 1.0, linearInRange);
  return vec2<f32>(theta, valid);
}

@compute @workgroup_size(${workgroupSize})
fn ${WGSL_OBSERVABLE_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= config.count) {
    return;
  }

  let base = index * ${WGSL_STATE_DIM}u;
  var y = vec4<f32>(
    initialStates[base + 0u],
    initialStates[base + 1u],
    initialStates[base + 2u],
    initialStates[base + 3u],
  );
  let p = params[index];
  let h = config.h;${compensationDecl}

  let x0 = y.x;
  // The launch point is always an apex candidate: it is the answer for a
  // downward launch and costs nothing otherwise.
  var bestT = 0.0;
  var bestHeight = y.y;

  // Ground-crossing bracket, captured on the first downward crossing and
  // refined after the loop. Held as scalars rather than an array because a
  // dynamically indexed local would defeat the uniformity analysis.
  var impacted = 0.0;
  var impT = 0.0;
  var impH = 0.0;
  var impY0 = 0.0;
  var impVy0 = 0.0;
  var impY1 = 0.0;
  var impVy1 = 0.0;
  var impX0 = 0.0;
  var impVx0 = 0.0;
  var impX1 = 0.0;
  var impVx1 = 0.0;

  // Uniform trip count, no early exit, no branch on state: the property
  // section 4.10 picks fixed-step RK4 for, preserved through the reduction.
  for (var n: u32 = 0u; n < config.steps; n = n + 1u) {
    let prev = y;
    ${stepStatement}

    // Times reconstructed from n, matching integratePlanarRk4's
    // round(t0 + round(n*h)) rather than an accumulated t += h, and the step
    // size taken as their difference exactly as the reference's reducer does.
    let tPrev = f32(n) * h;
    let tNext = f32(n + 1u) * h;
    let hStep = tNext - tPrev;

    let yy0 = prev.y;
    let vy0 = prev.w;
    let yy1 = next.y;
    let vy1 = next.w;

    // Apex: downward crossings of v_y only -- the upward crossing on a
    // bouncing arc is a minimum of y and would drag the scan to the ground.
    let apexCrossing = (vy0 >= 0.0) && (vy1 < 0.0) && (hStep > 0.0);
    let stat = hermiteStationaryTheta(yy0, vy0, yy1, vy1, hStep);
    let candidate = hermiteValue(yy0, vy0, yy1, vy1, hStep, stat.x);
    let takeApex = apexCrossing && (stat.y > 0.5) && (candidate > bestHeight);
    bestT = select(bestT, tPrev + (stat.x * hStep), takeApex);
    bestHeight = select(bestHeight, candidate, takeApex);

    // Ground crossing: first one only, which is what "range" means for a
    // bouncing arc. impacted is updated last, after every select that reads it.
    let crossing = (impacted < 0.5) && (yy0 >= 0.0) && (yy1 < 0.0) && (hStep > 0.0);
    impT = select(impT, tPrev, crossing);
    impH = select(impH, hStep, crossing);
    impY0 = select(impY0, yy0, crossing);
    impVy0 = select(impVy0, vy0, crossing);
    impY1 = select(impY1, yy1, crossing);
    impVy1 = select(impVy1, vy1, crossing);
    impX0 = select(impX0, prev.x, crossing);
    impVx0 = select(impVx0, prev.z, crossing);
    impX1 = select(impX1, next.x, crossing);
    impVx1 = select(impVx1, next.z, crossing);
    impacted = select(impacted, 1.0, crossing);

    y = next;${carryStatement}
  }

  // The final row is a candidate too: the answer for an arc cut off while
  // still climbing.
  let finalT = f32(config.steps) * h;
  let takeFinal = y.y > bestHeight;
  bestT = select(bestT, finalT, takeFinal);
  bestHeight = select(bestHeight, y.y, takeFinal);

  // One bisection, after the loop, the same fixed count on every thread. The
  // capture already established y(0) >= 0 > y(1), and a bisection on a bracket
  // holding a sign change cannot leave it -- so no convergence test, and so no
  // data-dependent trip count.
  var lo = 0.0;
  var hi = 1.0;
  for (var i: u32 = 0u; i < ${WGSL_IMPACT_BISECTION_STEPS}u; i = i + 1u) {
    let mid = 0.5 * (lo + hi);
    let value = hermiteValue(impY0, impVy0, impY1, impVy1, impH, mid);
    let goUp = value >= 0.0;
    lo = select(lo, mid, goUp);
    hi = select(hi, mid, !goUp);
  }
  let theta = 0.5 * (lo + hi);
  let impactX = hermiteValue(impX0, impVx0, impX1, impVx1, impH, theta);

  let didImpact = impacted > 0.5;
  let obase = index * ${WGSL_OBSERVABLE_DIM}u;
  observables[obase + 0u] = bestHeight;
  observables[obase + 1u] = bestT;
  observables[obase + 2u] = select(0.0, abs(impactX - x0), didImpact);
  observables[obase + 3u] = select(0.0, impT + (theta * impH), didImpact);
  observables[obase + 4u] = impacted;
}
`;
}

/**
 * The observables shader at the default {@link WGSL_WORKGROUP_SIZE}.
 *
 * `@__PURE__` for the reason `WGSL_RK4_KERNEL_SOURCE` carries it, which was
 * established by measurement rather than by principle: a module-scope call is
 * something a bundler must assume has side effects, so it keeps the call, the
 * builder and the whole shader text even though no route imports it. That cost
 * the app bundle a measured 1.2 kB gzipped on the equivalent change in the
 * 100th run. Removing the annotation silently re-adds it.
 */
export const WGSL_OBSERVABLES_KERNEL_SOURCE =
  /* @__PURE__ */ buildWgslObservablesKernelSource(WGSL_WORKGROUP_SIZE);
