import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  Environment,
  GravityForce,
  QuadraticDragForce,
  SMOOTH_SPHERE_CD_TABLE,
  TabulatedReynoldsCd,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  reynoldsNumber,
} from "@ballista/engine";
import type { DragCoefficientModel, EvalContext, Model } from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { measureConvergence } from "./convergence-harness.js";
import { integrate } from "./integrate.js";

/**
 * P4.34, Solver Lab exhibit for §3.3: what a C⁰-only `C_d(Re)` table costs you
 * in observed integrator convergence order.
 *
 * §3.3 prescribes PCHIP for `TabulatedReynoldsCd` "to guarantee smoothness of
 * f (a C⁰-only C_d(Re) degrades observed integrator convergence order — this
 * is itself a planned Solver Lab demonstration)". This file is that
 * demonstration, and it measures the claim rather than restating it.
 *
 * The setup is one scenario run twice with **only the interpolant differing**:
 * the same table data, the same projectile, the same launch state, the same
 * stepper, the same step sizes. Every number below therefore isolates the
 * smoothness of `C_d(Re)` and nothing else.
 *
 * Why convergence order is the right observable: RK4's order-4 error estimate
 * is derived from a Taylor expansion of the solution, which needs several
 * derivatives of the right-hand side to exist. Piecewise-linear interpolation
 * gives a `C_d` whose derivative *jumps* at every table node, so a step that
 * straddles a node sees an f that no Taylor polynomial matches, and that
 * step's local error falls back to a low power of h. It only takes a few such
 * steps along a flight to dominate the global error.
 *
 * Exhibit form: a documented test module rather than a new UI route, the same
 * pattern P4.09 and P4.22 used. `buildConvergenceFigure`-style rendering of an
 * (h, error) pair already exists generically in viz; nothing here needs
 * scenario-specific UI wiring.
 *
 * Integrator discipline (standing constraint): this is a *dissipative*
 * scenario — quadratic drag is the whole point of it — so the stepper is
 * classical RK4 throughout. No symplectic method appears anywhere in this
 * file.
 */

/**
 * Piecewise-linear interpolation over the same table `TabulatedReynoldsCd`
 * uses. Deliberately **test-local**: §3.3 prescribes PCHIP for the shipped
 * path, and exporting a knowingly-inferior interpolant from `@ballista/engine`
 * would invite exactly the mistake this exhibit exists to warn about. It lives
 * here, next to the measurement that justifies its existence.
 *
 * C⁰ but not C¹: values agree with the table at every node (asserted below),
 * and the slope jumps across each node.
 */
class PiecewiseLinearReynoldsCd implements DragCoefficientModel {
  constructor(private readonly table = SMOOTH_SPHERE_CD_TABLE) {}

  cd(re: number, _mach: number): number {
    const xs = this.table.re;
    const ys = this.table.cd;
    if (re <= xs[0]!) return ys[0]!;
    if (re >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
    let i = 0;
    while (re > xs[i + 1]!) i++;
    const t = (re - xs[i]!) / (xs[i + 1]! - xs[i]!);
    return ys[i]! + t * (ys[i + 1]! - ys[i]!);
  }
}

describe("C⁰-vs-C¹ Cd(Re) convergence degradation (P4.34, §3.3)", () => {
  // A size-5 football (0.43 kg, 0.11 m radius) driven hard: at 90 m/s its
  // Reynolds number is ~1.36e6 and it decelerates through the table's Re = 1e6
  // node during the 2 s window. One node crossing is enough, and is cleaner
  // than aiming at the drag-crisis cluster (see "Rejected configuration"
  // below).
  const MASS = 0.43;
  const RADIUS = 0.11;
  const LAUNCH_SPEED = 90;
  const LAUNCH_ANGLE = 0.35; // rad
  const TSPAN: readonly [number, number] = [0, 2];

  /** Fixed, geometrically spaced, spanning one decade of h. */
  const HS = [0.02, 0.01414, 0.01, 0.00707, 0.005, 0.00354, 0.0025] as const;

  /**
   * Reference step: 2^20 steps over the window, ~1300x finer than the finest
   * measured h. Its own error is bounded by the self-consistency check below,
   * not assumed.
   */
  const H_REF = (TSPAN[1] - TSPAN[0]) / 2 ** 20;

  const y0 = new Float64Array([
    0,
    0,
    LAUNCH_SPEED * Math.cos(LAUNCH_ANGLE),
    LAUNCH_SPEED * Math.sin(LAUNCH_ANGLE),
  ]);

  function buildScenario(cdModel: DragCoefficientModel): { model: Model; ctx: EvalContext } {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: MASS,
      radius: RADIUS,
      dragCoefficient: cdModel,
    });
    const ctx = createEvalContext(env, params);
    env.sample(0, 0, 0, ctx.env); // populate ctx.env.rho/eta for the Re bookkeeping below
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
    return { model, ctx };
  }

  function runAt(cdModel: DragCoefficientModel, h: number): Float64Array {
    const { model, ctx } = buildScenario(cdModel);
    const stepper = new ClassicalRK4Stepper();
    return integrate(
      model,
      ctx,
      y0,
      TSPAN,
      { stepper: stepper.info.id, h, maxSteps: Number.MAX_SAFE_INTEGER },
      stepper,
      [],
    ).yFinal;
  }

  function l2(a: Float64Array, b: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
    return Math.sqrt(sum);
  }

  /**
   * One convergence measurement, memoized: each call integrates ~1.5M steps
   * for its references, and every test below wants the same two results.
   */
  const cache = new Map<
    string,
    { errors: readonly number[]; slope: number; refSelfDiff: number }
  >();
  function study(label: "C0" | "C1") {
    const hit = cache.get(label);
    if (hit) return hit;
    const cdModel: DragCoefficientModel =
      label === "C1" ? new TabulatedReynoldsCd() : new PiecewiseLinearReynoldsCd();
    const refFine = runAt(cdModel, H_REF);
    const refCoarse = runAt(cdModel, 2 * H_REF);
    const { model, ctx } = buildScenario(cdModel);
    const result = measureConvergence(
      () => new ClassicalRK4Stepper(),
      model,
      ctx,
      y0,
      TSPAN,
      () => refFine,
      HS,
    );
    const value = {
      errors: result.errors,
      slope: result.slope,
      refSelfDiff: l2(refFine, refCoarse),
    };
    cache.set(label, value);
    return value;
  }

  it("the two interpolants carry the same table data and differ only in smoothness class", () => {
    const pchip = new TabulatedReynoldsCd();
    const linear = new PiecewiseLinearReynoldsCd();

    // Same data: both reproduce every tabulated point.
    for (let i = 0; i < SMOOTH_SPHERE_CD_TABLE.re.length; i++) {
      const re = SMOOTH_SPHERE_CD_TABLE.re[i]!;
      const cd = SMOOTH_SPHERE_CD_TABLE.cd[i]!;
      expect(pchip.cd(re, 0)).toBeCloseTo(cd, 12);
      expect(linear.cd(re, 0)).toBeCloseTo(cd, 12);
    }

    // Different smoothness: one-sided slopes across the Re = 1e6 node, the one
    // the trajectory below actually crosses. Linear interpolation's slope
    // jumps from (0.20-0.18)/6e5 to 0 there; PCHIP's matches across the node.
    const node = 1e6;
    const dRe = 1e3;
    const slopeLeft = (m: DragCoefficientModel) => (m.cd(node, 0) - m.cd(node - dRe, 0)) / dRe;
    const slopeRight = (m: DragCoefficientModel) => (m.cd(node + dRe, 0) - m.cd(node, 0)) / dRe;

    const linJump = Math.abs(slopeRight(linear) - slopeLeft(linear));
    const pchipJump = Math.abs(slopeRight(pchip) - slopeLeft(pchip));
    expect(linJump).toBeGreaterThan(3e-8); // measured 3.33e-8, the full segment slope
    expect(pchipJump).toBeLessThan(linJump / 100); // measured ~1e-13, i.e. finite-difference noise
  });

  it("the trajectory really crosses a table node (otherwise the comparison is vacuous)", () => {
    const { ctx } = buildScenario(new TabulatedReynoldsCd());
    const reAt = (speed: number) => reynoldsNumber(ctx.env.rho, speed, RADIUS, ctx.env.eta);
    const yEnd = runAt(new TabulatedReynoldsCd(), 0.001);
    const endSpeed = Math.hypot(yEnd[2]!, yEnd[3]!);

    const reStart = reAt(LAUNCH_SPEED);
    const reEnd = reAt(endSpeed);
    expect(reStart).toBeGreaterThan(1.3e6); // measured 1.356e6
    expect(reEnd).toBeLessThan(5e5); // measured 4.533e5
    // Re decreases monotonically here, so bracketing the node means crossing it.
    expect(reStart).toBeGreaterThan(1e6);
    expect(reEnd).toBeLessThan(1e6);
  });

  it("the fine reference is converged well below the errors being measured", () => {
    for (const label of ["C1", "C0"] as const) {
      const { errors, refSelfDiff } = study(label);
      const smallest = Math.min(...errors);
      // |y(h_ref) - y(2*h_ref)| bounds the reference's own error to within a
      // factor of (2^p - 1); requiring it under a fifth of the smallest
      // measured error keeps the reference out of the fit.
      expect(refSelfDiff).toBeLessThan(smallest / 5);
    }
  });

  it("C¹ (PCHIP) table: RK4 keeps a high observed order", () => {
    const { slope } = study("C1");
    // Measured 3.68 on this h decade. Not 4: PCHIP is C¹ but not C², so the
    // fourth-order Taylor argument is not fully available even here. That is a
    // real property of the shipped model and is stated rather than rounded up.
    expect(slope).toBeGreaterThan(3.0);
    expect(slope).toBeLessThan(4.3);
  });

  it("C⁰ (piecewise-linear) table: the observed order drops by more than one", () => {
    const c1 = study("C1").slope;
    const c0 = study("C0").slope;
    // Measured: C¹ 3.68, C⁰ 2.15 — a drop of 1.53. RK4 has fallen to roughly
    // the order of a second-order method while still paying for four stages
    // per step, which is the whole point of the exhibit.
    expect(c0).toBeLessThan(2.6);
    expect(c1 - c0).toBeGreaterThan(1.0);
  });

  it("the C⁰ table is less accurate at every step size, by one to four orders of magnitude", () => {
    const c1 = study("C1").errors;
    const c0 = study("C0").errors;
    const ratios = c0.map((e, i) => e / c1[i]!);
    // Measured ratios across the decade: 47, 958, 683, 537, 12075, 1182, 2215.
    // The spread is itself the story — see the next test.
    for (const ratio of ratios) expect(ratio).toBeGreaterThan(30);
    expect(Math.max(...ratios)).toBeGreaterThan(1e3);
  });

  it("with the C⁰ table, halving h is not guaranteed to reduce the error", () => {
    const c0 = study("C0").errors;
    let increases = 0;
    for (let i = 1; i < c0.length; i++) if (c0[i]! > c0[i - 1]!) increases++;
    // Measured: 2 of the 6 refinements make the error *worse* (1.59e-5 ->
    // 1.73e-5 and 3.29e-6 -> 4.41e-6). Where a node crossing lands relative to
    // the step grid matters as much as h does, so the error curve is no longer
    // a clean power law: fitted R² is 0.85 for C⁰ against 0.92 for C¹.
    expect(increases).toBeGreaterThanOrEqual(1);

    // Honesty check on the same measurement: the C¹ curve is not perfectly
    // monotone either (1 increase, measured), which is the C¹-not-C² caveat
    // above showing up again. The claim is comparative, not absolute.
    const c1 = study("C1").errors;
    let c1Increases = 0;
    for (let i = 1; i < c1.length; i++) if (c1[i]! > c1[i - 1]!) c1Increases++;
    expect(c1Increases).toBeLessThan(increases + 2);
  });

  it("the degradation costs real work: the C⁰ table at 8x more steps is still less accurate", () => {
    const c1 = study("C1").errors;
    const c0 = study("C0").errors;
    // C⁰ at the finest h (0.0025, 800 steps) vs C¹ at 0.01414 (~141 steps):
    // measured 1.24e-7 against 1.81e-8. Roughly 5.7x the work for ~7x the
    // error — refinement does not buy back what the kinks cost.
    const c0Finest = c0[c0.length - 1]!;
    const c1Coarse = c1[1]!;
    expect(c0Finest).toBeGreaterThan(c1Coarse);
  });
});
