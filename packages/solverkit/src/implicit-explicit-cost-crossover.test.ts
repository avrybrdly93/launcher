import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  ISA,
  LinearDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  dragRelaxationTimeLinear,
  sutherlandViscosity,
  type CharacteristicEnvironment,
} from "@ballista/engine";
import { BackwardEulerStepper } from "./backward-euler-stepper.js";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { integrate } from "./integrate.js";
import { bisectCriticalStepSize, isStepperStable } from "./stability-boundary-sweep.js";
import { measureWorkPrecision } from "./work-precision-harness.js";

/** P1.36's dust-grain preset projectile (§3.8's canonical stiffness demonstration; same construction P4.21's tests use). */
function createDustGrainParams() {
  const radius = 5e-6;
  const mass = (4 / 3) * Math.PI * Math.pow(radius, 3) * 2000;
  return createSphericalProjectileParams({ mass, radius, dragCoefficient: new ConstantCd(0.5) });
}

const VX_CHANNEL = 2;
const NSTEPS_STABILITY_PROBE = 40;

/**
 * P4.22's exhibit (§4, blueprint line ~425's "error-vs-cost diagram makes it
 * visceral" motivation): a work-precision *overlay* comparing {@link
 * BackwardEulerStepper} (P2.38/P4.21, A-stable, simplified/chord-Newton
 * mode) against {@link ClassicalRK4Stepper} (explicit, order 4 -- the
 * standing symplectic-only-for-conservative-dynamics rule means an RK
 * scheme, never Verlet/symplectic Euler, is the correct explicit comparator
 * on this dissipative drag scenario) on the platform's canonical stiff
 * scenario: the dust grain (gravity + linear/Stokes drag, P1.36/P2.38/P4.21's
 * `DUST_GRAIN` preset construction).
 *
 * Follows the codebase's established "exhibit" pattern for phase-4 tasks
 * (a thoroughly-tested, well-documented `solverkit` module -- see P4.09's
 * `topspin-backspin-curve-comparison.test.ts`) rather than a new UI route:
 * P3.30 already built a fully generic work-precision Plotly pane
 * (`buildWorkPrecisionFigure`, `packages/viz/src/lazy-plotly-pane.ts`) that
 * renders *any* `WorkPrecisionCurve[]` overlay, so no scenario-specific UI
 * wiring is needed to *display* this exhibit's data -- only the data itself
 * (this module) is new.
 *
 * The work-precision harness's cost metric (P2.19's `nRHS`, rhs
 * evaluations) already prices the implicit method honestly: each Newton
 * iteration's residual/candidate evaluation calls `model.rhs` and is
 * counted, so backward Euler's per-step Newton-solve overhead is baked
 * directly into its curve's cost axis, not hand-waved away.
 *
 * ## The crossover, as measured by this file's own tests below
 *
 * On this scenario (τ ≈ 0.621 ms Stokes relaxation time, integrated to
 * t_f = 50 ms ≈ 80τ):
 *
 * - Explicit RK4 is unconditionally unstable for h ≳ h_crit(RK4) ≈ 2.785τ
 *   ≈ 1.730 ms (the real-axis Dahlquist bound for RK4's stability
 *   polynomial; confirmed here by empirical bisection, not just asserted
 *   from the formula -- see "RK4's stability wall" below). Its *cheapest
 *   viable* configuration on this scenario is h ≈ 1.6 ms, costing 128 rhs
 *   evaluations for a global error of ≈ 4.2e-4.
 * - Backward Euler (A-stable) is never limited by that wall. At h = 10 ms
 *   (≈ 16τ -- more than 6× larger than RK4's entire stable range) it costs
 *   only 51 rhs evaluations yet reaches error ≈ 1.0e-5, already both
 *   *cheaper and more accurate* than RK4's cheapest stable point.
 *
 * So the crossover point sits right at RK4's stability wall, roughly
 * **nRHS ≈ 130, error ≈ 4e-4**: for any target error looser than that (the
 * entire practically-relevant range down to backward Euler's own
 * Newton-tolerance floor around 1e-11), backward Euler reaches it at lower
 * cost than any stable RK4 configuration, because RK4 has *no* configuration
 * cheaper than its stability floor at all on this problem -- the classic
 * "explicit needs far smaller steps than accuracy alone would demand,
 * purely for stability" story (blueprint §4.6/§4, line ~425). Only once a
 * target error is tighter than backward Euler's own Newton-tolerance
 * ceiling (≈1e-11, a solver-configuration limit, not a discretization one)
 * does RK4 -- already forced stable and so already sitting at
 * near-machine-epsilon accuracy for roughly the same fixed cost -- become
 * the only economical choice.
 */
describe("implicit-vs-explicit cost exhibit on the dust-grain stiff scenario (P4.22)", () => {
  const params = createDustGrainParams();
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const ctx = createEvalContext(env, params);
  // gravity+linear-drag has no analytic Jacobian (P1.22 scopes that to
  // quadratic drag), so both steppers exercise BackwardEulerStepper's FD
  // Jacobian fallback here -- the actual production configuration, not a
  // best-case analytic-Jacobian shortcut.
  const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
  const y0 = new Float64Array([0, 0.01, 15, 0]); // P1.36 dust-grain preset ICs
  const tspan: readonly [number, number] = [0, 0.05]; // 50 ms =~ 80 tau

  const charEnv: CharacteristicEnvironment = { rho: ISA.rho0, eta: sutherlandViscosity(ISA.T0) };
  const tau = dragRelaxationTimeLinear(params, charEnv);

  /** Linear-drag + gravity closed form (§3.6-3.7), the same formula P2.38/P4.21's own tests use as ground truth. */
  function yExact(t: number): Float64Array {
    env.sample(0, 0, 0, ctx.env);
    const b = 6 * Math.PI * ctx.env.eta * params.radius;
    const vT = (params.mass * ctx.env.g) / b;
    const [x0, yy0, vx0, vy0] = y0 as unknown as [number, number, number, number];
    const decay = Math.exp(-t / tau);
    const oneMinusDecay = -Math.expm1(-t / tau);
    const x = x0 + vx0 * tau * oneMinusDecay;
    const y = yy0 - vT * t + (vy0 + vT) * tau * oneMinusDecay;
    const vx = vx0 * decay;
    const vy = -vT + (vy0 + vT) * decay;
    return new Float64Array([x, y, vx, vy]);
  }

  it("sanity: tau matches this scenario's known stiffness scale (P4.21's own dust-grain fixture)", () => {
    // Same order of magnitude P4.21's stability demo relies on
    // (predictedHCritEuler = 2*tau there); pinned here so this exhibit's
    // hard-coded h values below stay meaningful if the preset ever changes.
    expect(tau).toBeGreaterThan(1e-4);
    expect(tau).toBeLessThan(1e-3);
  });

  describe("RK4's stability wall (empirical, not just formula-asserted)", () => {
    it("bisected h_crit(RK4) matches the theoretical real-axis bound 2.785*tau", () => {
      const boundary = bisectCriticalStepSize(
        (h) =>
          isStepperStable(
            new ClassicalRK4Stepper(),
            model,
            ctx,
            y0,
            h,
            NSTEPS_STABILITY_PROBE,
            VX_CHANNEL,
          ),
        1e-3, // known-stable bracket end
        3e-3, // known-unstable bracket end
      );
      const theoreticalHCrit = 2.785 * tau;
      expect(boundary.hCrit).toBeCloseTo(theoreticalHCrit, 4);
    });

    it("just above the wall, RK4 doesn't merely lose a few digits -- it blows up by orders of magnitude", () => {
      // h = 1.8 ms is only ~4% above the ~1.73 ms empirical/theoretical
      // h_crit(RK4) bisected above, yet integrating the *full* tspan (many
      // e-foldings of the unstable growth factor) drives vx from its
      // physically-correct near-zero terminal value (80 tau of decay) up
      // into the hundreds of m/s.
      const stepper = new ClassicalRK4Stepper();
      const report = integrate(
        model,
        ctx,
        y0,
        tspan,
        { stepper: stepper.info.id, h: 0.0018, maxSteps: Number.MAX_SAFE_INTEGER },
        stepper,
      );
      expect(report.status).toBe("ok");
      // True vx(t_f) is ~0 (15 * exp(-80.5) is far below float64 precision).
      expect(Math.abs(report.yFinal[VX_CHANNEL]!)).toBeGreaterThan(100);
    });

    it("backward Euler stays stable and accurate at step sizes fully beyond RK4's entire stable range", () => {
      // 10 ms and 20 ms are respectively ~5.8x and ~11.6x RK4's own
      // stability ceiling (~1.73 ms) -- values RK4 cannot use *at all* --
      // yet A-stable backward Euler (P2.38/P4.21) integrates them cleanly.
      for (const h of [0.02, 0.01]) {
        const stepper = new BackwardEulerStepper({ newtonMode: "simplified" });
        const report = integrate(
          model,
          ctx,
          y0,
          tspan,
          { stepper: stepper.info.id, h, maxSteps: Number.MAX_SAFE_INTEGER },
          stepper,
        );
        expect(report.status).toBe("ok");
        expect(Math.abs(report.yFinal[VX_CHANNEL]!)).toBeLessThan(1);
      }
    });
  });

  describe("work-precision overlay: the crossover point", () => {
    it("backward Euler's curve is monotonically decreasing (well-posed cost-vs-accuracy tradeoff)", () => {
      const curve = measureWorkPrecision(
        () => new BackwardEulerStepper({ newtonMode: "simplified" }),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        [0.02, 0.01, 0.005, 0.0025],
      );
      expect(curve.method).toBe("backward-euler");
      for (let i = 1; i < curve.points.length; i++) {
        expect(curve.points[i]!.error).toBeLessThan(curve.points[i - 1]!.error);
      }
    });

    it("RK4's cheapest *stable* configuration on this scenario costs ~128 rhs evals for ~4e-4 error", () => {
      // h = 1.6 ms is the largest round step below the bisected h_crit
      // above (~1.73 ms); RK4 has no viable configuration cheaper than
      // this on the dust-grain scenario -- any larger h is the
      // orders-of-magnitude blowup demonstrated above, not a gradual
      // accuracy tradeoff.
      const curve = measureWorkPrecision(
        () => new ClassicalRK4Stepper(),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        [0.0016, 0.0012],
      );
      expect(curve.method).toBe("classical-rk4");
      const cheapest = curve.points[0]!;
      expect(cheapest.nRHS).toBeCloseTo(128, 0);
      expect(cheapest.error).toBeGreaterThan(1e-5);
      expect(cheapest.error).toBeLessThan(1e-3);
      // Once forced stable, RK4's *next* step down is already essentially
      // exact (machine epsilon) -- confirming the "wall, not slope" shape:
      // there is no intermediate, moderately-priced, moderately-accurate
      // RK4 regime on this scenario the way there is for backward Euler.
      expect(curve.points[1]!.error).toBeLessThan(1e-12);
    });

    it("crossover: at/below RK4's stability-floor cost, backward Euler is simultaneously cheaper AND more accurate", () => {
      const beCurve = measureWorkPrecision(
        () => new BackwardEulerStepper({ newtonMode: "simplified" }),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        [0.01],
      );
      const rk4Curve = measureWorkPrecision(
        () => new ClassicalRK4Stepper(),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        [0.0016],
      );

      const be = beCurve.points[0]!;
      const rk4Floor = rk4Curve.points[0]!;

      // The crossover point this task's validation criterion asks to make
      // visible: backward Euler at h=10ms (nRHS=51) both costs less than
      // half of RK4's cheapest stable configuration (nRHS=128) *and*
      // achieves a global error more than an order of magnitude tighter
      // (~1e-5 vs ~4e-4) -- RK4 is strictly Pareto-dominated below its own
      // stability wall, not just "a bit more expensive".
      expect(be.nRHS).toBeLessThan(rk4Floor.nRHS / 2);
      expect(be.error).toBeLessThan(rk4Floor.error / 10);
    });

    it("beyond backward Euler's Newton-tolerance floor, RK4 (once stable) is the only economical way to tighter accuracy", () => {
      // Backward Euler's error plateaus around 1e-11-1e-12 as h keeps
      // shrinking (Newton convergence tolerance, not discretization error,
      // dominates there -- see P4.21's own notes on this same floor).
      const beCurve = measureWorkPrecision(
        () => new BackwardEulerStepper({ newtonMode: "simplified" }),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        [0.0025, 0.00125],
      );
      const floorError = Math.min(...beCurve.points.map((p) => p.error));
      expect(floorError).toBeGreaterThan(1e-13);

      // RK4, once past its stability wall, reaches error far tighter than
      // that floor (machine epsilon) at a cost only ~30% above its own
      // stability-floor configuration -- the only way past backward
      // Euler's ceiling on this scenario without loosening its Newton
      // tolerances.
      const rk4Curve = measureWorkPrecision(
        () => new ClassicalRK4Stepper(),
        model,
        ctx,
        y0,
        tspan,
        yExact,
        [0.0012],
      );
      expect(rk4Curve.points[0]!.error).toBeLessThan(floorError / 1000);
    });
  });
});
