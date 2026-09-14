/**
 * f32-versus-f64 error budgets for the planar observables reduction, per
 * scenario class (P7.17).
 *
 * ## The question, and the one variable it moves
 *
 * P7.16 established that the WGSL observables reduction reproduces
 * {@link reducePlanarObservables} at `round = toF32` **bit-identically** -- 0
 * ULP over 50000 values and 10000 trajectories on a real adapter. That settles
 * that the device computes what the f32 CPU reference computes. It says nothing
 * about whether *either* is close enough to the answer.
 *
 * This module asks the remaining question: given that the device is exactly the
 * f32 reduction, how far is the f32 reduction from the same reduction at f64,
 * and for which scenarios is that gap large enough that the f32 path should not
 * be used at all.
 *
 * Both arms are therefore **the same algorithm over the same fixed-step march**,
 * differing only in `RoundFn`. That is the point and not a convenience: a budget
 * that will be used to say "f32 is inadequate here" has to be attributable to
 * precision. Differencing against `@ballista/analysis`'s adaptive,
 * event-localised f64 observables would move arithmetic width, step policy and
 * event handling simultaneously, and a disagreement would be a statement about
 * how three errors combined. That comparison is still worth having -- it is what
 * catches an f64 arm that is itself wrong, since two arms that agree only
 * because they share a mistake have measured nothing -- so it is available as
 * {@link discretisationReference}, kept separate and labelled for what it is.
 *
 * ## Why the f32 CPU arm stands in for the device
 *
 * Because P7.16 measured that substitution rather than assuming it. The limit of
 * that licence is real and is carried in the data: P7.16's 0 ULP was measured
 * over P7.16's ensemble, so {@link PrecisionStudyRow.withinP716Family} records
 * per class whether the substitution is covered by that measurement or is being
 * extended past it. A row outside the family is still a valid f32-vs-f64
 * statement; it is the "and the GPU does exactly this" half that weakens.
 *
 * ## What is deliberately absent
 *
 * No timing, throughput or bandwidth figure. P7.17 is about error. Cost is
 * P7.20's question and needs hardware this container does not have.
 */

import { identity, toF32, type PlanarDragParams, type RoundFn } from "@ballista/solverkit";

import {
  reducePlanarObservables,
  type PlanarObservablesOptions,
} from "./planar-observables-flight.js";
import type { PlanarObservables } from "./planar-observables-reduction.js";

/**
 * The observable channels a budget is stated over.
 *
 * `impacted` is excluded deliberately: it is a boolean, so "error" in it is not
 * a magnitude but a disagreement, and it is reported separately by
 * {@link PrecisionStudyRow.impactedAgrees}. A class where f32 and f64 disagree
 * about whether the flight landed at all has failed in a way no relative
 * tolerance describes.
 */
export const OBSERVABLE_CHANNELS = ["apexHeight", "apexT", "range", "impactT"] as const;

/** One observable channel of {@link PlanarObservables}. */
export type ObservableChannel = (typeof OBSERVABLE_CHANNELS)[number];

/**
 * A scenario class, in the repo's own `RegimeTag` vocabulary where the kernel's
 * model can express one.
 *
 * `magnus` is absent and its absence is a finding rather than an omission:
 * `PlanarDragParams` has no spin channel, so a Magnus scenario is outside the
 * kernel's **model**, not outside f32's reach. Reporting it as a precision
 * budget would be reporting a number about a thing that cannot be run.
 * {@link MODEL_COVERAGE_GAPS} records it, and the published table carries it as
 * a coverage row.
 */
export type ScenarioClass = "low-pi" | "high-pi" | "stiff";

/** A scenario the study can run: parameters plus the launch state and march. */
export interface PrecisionScenario {
  /** Stable identifier, used as the row key in the recorded results. */
  readonly id: string;
  /** Which class this scenario is an instance of. */
  readonly scenarioClass: ScenarioClass;
  /** One line on what the scenario physically is. */
  readonly description: string;
  /** Model parameters. */
  readonly params: PlanarDragParams;
  /** Initial state `[x, y, vx, vy]`. */
  readonly y0: readonly number[];
  /** Fixed step size. */
  readonly h: number;
  /** Number of steps to march. */
  readonly steps: number;
  /**
   * Whether P7.16's measured 0-ULP device agreement covers this scenario's
   * parameter family, i.e. whether "the GPU computes exactly the f32 arm" is
   * measured here or extrapolated. See the module header.
   */
  readonly withinP716Family: boolean;
  /**
   * Start time on the flight's own clock; defaults to 0.
   *
   * Exposed because it is the knob the clock control turns. The physics is
   * invariant under a shift of the time origin, so any change in the observables
   * that follows from moving `t0` is a statement about the *representation* of
   * time and not about the flight -- which is what makes it a control rather
   * than another measurement. See `planar-precision-study.test.ts`.
   */
  readonly t0?: number;
}

/**
 * The f32 resolution at `x`: the gap to the next binary32 value.
 *
 * The study's governing quantity turned out to be `ulp32(t) / h` -- how finely
 * the clock can resolve a step at the time the march has reached -- so it is
 * computed here rather than estimated, via the bit pattern rather than via a
 * scaled epsilon, so it is right in the subnormal range and across every binade.
 */
export function ulp32(x: number): number {
  const a = Math.fround(Math.abs(x));
  if (!Number.isFinite(a)) return Number.NaN;
  // Smallest positive subnormal: the gap below the first normal binade.
  if (a === 0) return 1.401298464324817e-45;
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, a);
  view.setUint32(0, view.getUint32(0) + 1);
  return view.getFloat32(0) - a;
}

/**
 * Model-coverage gaps: scenario classes the planar kernel cannot express at all,
 * with the reason. Distinct from a precision verdict, and kept distinct in the
 * published table, because "f32 is not accurate enough for this" and "this
 * cannot be run here in any precision" are different statements and only the
 * first is a budget.
 */
export const MODEL_COVERAGE_GAPS = [
  {
    regimeTag: "magnus",
    reason:
      "PlanarDragParams carries mass, area, cd, rho, g, windX, windY and no spin channel, so a " +
      "Magnus force cannot be wired at all. Outside the kernel's model, not outside f32's reach.",
  },
  {
    regimeTag: "stiff/stokes",
    reason:
      "The library's canonical stiff preset (dust-grain) uses linear Stokes drag, which " +
      "PlanarDragParams also cannot express -- its drag term is quadratic with a constant Cd. " +
      "The stiff row below is therefore a quadratic-drag scenario placed past recommendSolver's " +
      "own threshold, not the library preset.",
  },
] as const;

/** Relative and absolute error for one observable channel. */
export interface ChannelError {
  /** The f64 arm's value: the reference. */
  readonly reference: number;
  /** The f32 arm's value. */
  readonly measured: number;
  /** `|measured - reference|`. */
  readonly absolute: number;
  /**
   * `absolute / |reference|`, or `0` when both are exactly zero.
   *
   * `NaN` when the reference is zero and the measured value is not -- a relative
   * error against a zero reference is not a number, and returning a large finite
   * value there would let a total disagreement pass as a big-but-finite one.
   */
  readonly relative: number;
}

/** The comparison for one scenario. */
export interface PrecisionStudyRow {
  readonly id: string;
  readonly scenarioClass: ScenarioClass;
  readonly description: string;
  /** Whether both arms agree the flight reached the ground. */
  readonly impactedAgrees: boolean;
  /** Per-channel error, f32 arm against f64 arm. */
  readonly channels: Readonly<Record<ObservableChannel, ChannelError>>;
  /** The largest {@link ChannelError.relative} across {@link OBSERVABLE_CHANNELS}. */
  readonly worstRelative: number;
  /** The channel {@link worstRelative} came from. */
  readonly worstChannel: ObservableChannel;
  /** See {@link PrecisionScenario.withinP716Family}. */
  readonly withinP716Family: boolean;
}

/**
 * Relative error, with the zero-reference case handled rather than divided
 * through.
 */
export function relativeError(reference: number, measured: number): number {
  const absolute = Math.abs(measured - reference);
  if (reference === 0) return measured === 0 ? 0 : Number.NaN;
  return absolute / Math.abs(reference);
}

/**
 * Runs one scenario at both precisions and differences the observables.
 *
 * The two arms share `y0`, `h`, `steps` and `params` by construction -- they are
 * read from the same {@link PrecisionScenario} -- so the only difference between
 * them is `round`. `reducePlanarObservables` rounds the initial state and the
 * start time through its own `round`, which is what makes the f32 arm start from
 * a representable state rather than from an f64 one it silently truncates on
 * first use.
 */
export function runPrecisionScenario(scenario: PrecisionScenario): PrecisionStudyRow {
  const base = {
    y0: scenario.y0,
    h: scenario.h,
    steps: scenario.steps,
    params: scenario.params,
    t0: scenario.t0 ?? 0,
  } satisfies Omit<PlanarObservablesOptions, "round">;

  const f64 = reducePlanarObservables({ ...base, round: identity });
  const f32 = reducePlanarObservables({ ...base, round: toF32 });

  const channels = {} as Record<ObservableChannel, ChannelError>;
  let worstRelative = -1;
  let worstChannel: ObservableChannel = OBSERVABLE_CHANNELS[0];

  for (const channel of OBSERVABLE_CHANNELS) {
    const reference = f64[channel];
    const measured = f32[channel];
    const relative = relativeError(reference, measured);
    channels[channel] = {
      reference,
      measured,
      absolute: Math.abs(measured - reference),
      relative,
    };
    // NaN loses every comparison, so a NaN relative error would silently never
    // become the worst channel. Treat it as maximal instead: a relative error
    // against a zero reference is the least trustworthy number in the row, not
    // the most.
    const rank = Number.isNaN(relative) ? Number.POSITIVE_INFINITY : relative;
    if (rank > worstRelative) {
      worstRelative = rank;
      worstChannel = channel;
    }
  }

  return {
    id: scenario.id,
    scenarioClass: scenario.scenarioClass,
    description: scenario.description,
    impactedAgrees: f64.impacted === f32.impacted,
    channels,
    worstRelative,
    worstChannel,
    withinP716Family: scenario.withinP716Family,
  };
}

/**
 * The f64 arm on its own, exposed so a caller can check it against something
 * that is *not* its own twin.
 *
 * The study's budget compares f32 against f64 over one march, which proves the
 * two precisions agree and nothing about whether the algorithm is right. On the
 * drag-free case the closed forms settle that independently, and the Hermite
 * refinement is not merely accurate there but exact to roundoff: `y(t)` is a
 * quadratic, `v_y(t)` is linear, and a cubic Hermite reproduces any cubic
 * exactly, so the interpolant *is* the arc. `planar-precision-study.test.ts`
 * uses this for that check.
 */
export function discretisationReference(
  scenario: PrecisionScenario,
  round: RoundFn = identity,
): PlanarObservables {
  return reducePlanarObservables({
    y0: scenario.y0,
    h: scenario.h,
    steps: scenario.steps,
    params: scenario.params,
    t0: scenario.t0 ?? 0,
    round,
  });
}

/**
 * The relative budget the published table certifies against: 1e-5.
 *
 * Chosen against what the observables are for rather than by rounding binary32's
 * epsilon to a comfortable figure. Apex height and range feed range tables, aim
 * solves and envelope plots; 1e-5 relative is a centimetre on a kilometre, well
 * inside the modelling error of a constant-Cd, constant-density, uniform-wind
 * model, and roughly two orders of magnitude above the ~1e-7 floor a short march
 * actually achieves. A budget at the floor would certify nothing -- it would be
 * a restatement of the machine epsilon -- and a budget far above it would
 * certify scenarios whose answers are visibly wrong.
 *
 * `planar-precision-study.test.ts` runs a control demonstrating the defect
 * this number must catch, which is the part P7.16 got wrong first time round
 * and recorded as the lesson to carry: a tolerance picked from a plausible
 * mechanism, with no control showing it rejects what it must reject, is a
 * decoration rather than a gate.
 */
export const RELATIVE_BUDGET = 1e-5;

/**
 * Whether the f32 path may be used for a scenario, and why not when it may not.
 *
 * `model-gap` is deliberately not a precision verdict: it marks a scenario the
 * kernel cannot express at all, where reporting an error budget would be
 * reporting a number about something that cannot be run.
 */
export type PrecisionVerdict = "f32-ok" | "cpu-only" | "model-gap";

/** A published row: the measurement, the verdict, and the reason for it. */
export interface PrecisionBudgetRow extends PrecisionStudyRow {
  readonly verdict: PrecisionVerdict;
  readonly reason: string;
}

/**
 * Applies {@link RELATIVE_BUDGET} to a measured row.
 *
 * Two failure modes, and they are not the same thing. A row where the two arms
 * disagree about `impacted` has not merely exceeded a tolerance -- one arm
 * believes the flight never landed and is reporting `range: 0`, which no
 * relative tolerance describes and which a caller reading `range` would never
 * notice. It is checked first and reported in its own words.
 */
export function applyBudget(row: PrecisionStudyRow): PrecisionBudgetRow {
  if (!row.impactedAgrees) {
    return {
      ...row,
      verdict: "cpu-only",
      reason:
        "The two arms disagree about whether the flight reached the ground, so one of them is " +
        "reporting range 0 for a flight that landed. Not a tolerance failure -- a silent one.",
    };
  }
  if (!(row.worstRelative <= RELATIVE_BUDGET)) {
    return {
      ...row,
      verdict: "cpu-only",
      reason:
        `Worst relative error ${row.worstRelative.toExponential(2)} on ${row.worstChannel} ` +
        `exceeds the ${RELATIVE_BUDGET.toExponential(0)} budget.`,
    };
  }
  return {
    ...row,
    verdict: "f32-ok",
    reason:
      `Worst relative error ${row.worstRelative.toExponential(2)} on ${row.worstChannel}, ` +
      `within the ${RELATIVE_BUDGET.toExponential(0)} budget.`,
  };
}

/** One point of {@link sweepStiffness}. */
export interface StiffnessSweepPoint {
  /** Launch speed, m/s. */
  readonly v0: number;
  /** The advisor's stiffness ratio, `2 * Pi` for quadratic drag. */
  readonly stiffnessRatio: number;
  /** Drag relaxation time at launch, s. */
  readonly tau: number;
  /** The step used: a fixed fraction of `tau`, i.e. pinned by stability. */
  readonly h: number;
  /** Steps needed to reach the ground at that step. */
  readonly steps: number;
  /** Worst relative error across {@link OBSERVABLE_CHANNELS}. */
  readonly worstRelative: number;
  /** Whether the f32 arm still saw the impact. */
  readonly f32Impacted: boolean;
}

/**
 * Sweeps launch speed so the stiffness ratio sweeps, with the step pinned to a
 * fraction of the relaxation time.
 *
 * This is the measurement that connects stiffness to the budget, and the pinning
 * is the whole point. A caller running a *non*-stiff scenario chooses the step
 * for accuracy and can always choose a coarser one; a caller running a stiff
 * scenario cannot, because an explicit method is unstable above roughly
 * `2.78 * tau`. So in the stiff class the step count is set by the physics, and
 * since the f32 error accumulates with step count, so is the achievable
 * accuracy. Sweeping `v0` moves `Pi` as `v0^2` and therefore moves the ratio
 * without changing one property of the projectile, which isolates the regime
 * from everything else.
 */
export function sweepStiffness(
  params: PlanarDragParams,
  speeds: readonly number[],
  options: { readonly degrees: number; readonly tauFraction: number },
): readonly StiffnessSweepPoint[] {
  const points: StiffnessSweepPoint[] = [];
  for (const v0 of speeds) {
    const pi = (params.rho * params.cd * params.area * v0 * v0) / (2 * params.mass * params.g);
    const tau = v0 / (2 * params.g * pi);
    const h = options.tauFraction * tau;
    const theta = (options.degrees * Math.PI) / 180;
    const y0 = [0, 0, v0 * Math.cos(theta), v0 * Math.sin(theta)];

    // Grow the march until the f64 arm lands. Comparing two flights that never
    // reached the ground would compare `range: 0` against `range: 0` and report
    // perfect agreement having measured nothing -- the vacuous-pass trap P7.16
    // built its 12000-step fixture to avoid.
    let steps = 256;
    let f64 = reducePlanarObservables({ y0, h, steps, params, round: identity });
    while (!f64.impacted && steps < 1 << 22) {
      steps *= 2;
      f64 = reducePlanarObservables({ y0, h, steps, params, round: identity });
    }
    if (!f64.impacted) continue;
    const f32 = reducePlanarObservables({ y0, h, steps, params, round: toF32 });

    let worst = 0;
    for (const channel of OBSERVABLE_CHANNELS) {
      const relative = relativeError(f64[channel], f32[channel]);
      const rank = Number.isNaN(relative) ? Number.POSITIVE_INFINITY : relative;
      if (rank > worst) worst = rank;
    }

    points.push({
      v0,
      stiffnessRatio: 2 * pi,
      tau,
      h,
      steps,
      worstRelative: worst,
      f32Impacted: f32.impacted,
    });
  }
  return points;
}
