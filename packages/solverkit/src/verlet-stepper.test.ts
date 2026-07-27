import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  mechanicalEnergy,
  ConstantCd,
  type ChannelMeta,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { measureConvergence } from "./convergence-harness.js";
import { integrate } from "./integrate.js";
import { SemiImplicitEulerStepper } from "./semi-implicit-euler-stepper.js";
import { createStepResult, type Stepper } from "./types.js";
import { VerletStepper } from "./verlet-stepper.js";

const OSCILLATOR_CHANNELS: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "v", unit: "m/s" },
];

/**
 * Simple harmonic oscillator (dq/dt=v, dv/dt=-omega^2 q), used the same way
 * as P2.15's semi-implicit-Euler test: unlike pure uniform gravity (whose
 * acceleration is exactly constant, so Verlet reproduces the true quadratic
 * solution exactly for ANY h -- no error curve to fit a slope against, see
 * below), this state-dependent restoring force has genuine O(h^3) local
 * truncation error and a closed-form solution, so it is what actually
 * exercises Verlet's order-2 global convergence.
 */
function createHarmonicOscillatorModel(omega: number): Model {
  const omega2 = omega * omega;
  return {
    dim: 2,
    channels: OSCILLATOR_CHANNELS,
    partitions: { q: [0], p: [1] },
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = y[1]!;
      out[1] = -omega2 * y[0]!;
    },
  };
}

function oscillatorExact(omega: number, x0: number, v0: number, t: number): Float64Array {
  const c = Math.cos(omega * t);
  const s = Math.sin(omega * t);
  return new Float64Array([x0 * c + (v0 / omega) * s, -x0 * omega * s + v0 * c]);
}

function oscillatorEnergy(omega: number, y: Float64Array): number {
  return 0.5 * y[1]! * y[1]! + 0.5 * omega * omega * y[0]! * y[0]!;
}

const OSCILLATOR_WITH_SPIN_CHANNELS: readonly ChannelMeta[] = [
  { name: "x", unit: "m" },
  { name: "v", unit: "m/s" },
  { name: "omega", unit: "rad/s" },
];

/**
 * P4.10: the harmonic oscillator above (q=[0], p=[1]) plus a third,
 * unpartitioned scalar channel decaying as omega_dot=-omega/tauOmega --
 * the same shape the dim-5 spin model (planar-projectile-spin-model.ts,
 * P4.07) adds to the dim-4 workhorse, but decoupled from q/p so both
 * channels have independent closed-form solutions to check convergence
 * order against ({@link oscillatorWithSpinExact}). Exercises exactly the
 * "partitioned dims with extra scalar state" case VerletStepper's own
 * docstring describes: the companion step in `stepVelocityVerlet`/
 * `stepPositionVerlet` advances index 2 the same way it would advance a
 * spin channel.
 */
function createOscillatorWithSpinModel(omega: number, tauOmega: number): Model {
  const omega2 = omega * omega;
  return {
    dim: 3,
    channels: OSCILLATOR_WITH_SPIN_CHANNELS,
    partitions: { q: [0], p: [1] },
    rhs(_t: number, y: Float64Array, out: Float64Array): void {
      out[0] = y[1]!;
      out[1] = -omega2 * y[0]!;
      out[2] = -y[2]! / tauOmega;
    },
  };
}

function oscillatorWithSpinExact(
  omega: number,
  tauOmega: number,
  x0: number,
  v0: number,
  omega0: number,
  t: number,
): Float64Array {
  const c = Math.cos(omega * t);
  const s = Math.sin(omega * t);
  return new Float64Array([
    x0 * c + (v0 / omega) * s,
    -x0 * omega * s + v0 * c,
    omega0 * Math.exp(-t / tauOmega),
  ]);
}

/** L2 error restricted to the (q, p) = (index 0, 1) channels. */
function qpErrorNorm(numeric: Float64Array, exact: Float64Array): number {
  const dq = numeric[0]! - exact[0]!;
  const dp = numeric[1]! - exact[1]!;
  return Math.sqrt(dq * dq + dp * dp);
}

/** Error restricted to the unpartitioned omega channel (index 2). */
function omegaErrorNorm(numeric: Float64Array, exact: Float64Array): number {
  return Math.abs(numeric[2]! - exact[2]!);
}

describe("VerletStepper (P2.16)", () => {
  describe("info metadata", () => {
    it("velocity variant: id velocity-verlet, order 2, symplectic, non-FSAL", () => {
      expect(new VerletStepper("velocity").info).toEqual({
        id: "velocity-verlet",
        order: 2,
        fsal: false,
        symplectic: true,
      });
    });

    it("position variant: id position-verlet, order 2, symplectic, non-FSAL", () => {
      expect(new VerletStepper("position").info).toEqual({
        id: "position-verlet",
        order: 2,
        fsal: false,
        symplectic: true,
      });
    });

    it("defaults to the velocity variant", () => {
      expect(new VerletStepper().info.id).toBe("velocity-verlet");
    });
  });

  describe("guards", () => {
    it("throws in init() if the model declares no partitions", () => {
      const model: Model = {
        dim: 1,
        channels: [{ name: "y", unit: "1" }],
        rhs(_t, y, out) {
          out[0] = -y[0]!;
        },
      };
      expect(() => new VerletStepper().init(model, {} as EvalContext)).toThrow();
    });

    it("throws in init() if q/p partition arrays have mismatched lengths", () => {
      const model: Model = {
        dim: 2,
        channels: OSCILLATOR_CHANNELS,
        partitions: { q: [0], p: [] },
        rhs(_t, y, out) {
          out[0] = y[1]!;
          out[1] = 0;
        },
      };
      expect(() => new VerletStepper().init(model, {} as EvalContext)).toThrow();
    });

    it("throws if step() is called before init()", () => {
      const stepper = new VerletStepper();
      expect(() => stepper.step(0, new Float64Array([0, 1]), 0.1, createStepResult(2))).toThrow();
    });
  });

  describe("gravity-only: exact (constant acceleration is reproduced with no discretization error)", () => {
    for (const variant of ["velocity", "position"] as const) {
      it(`${variant} variant: energy is conserved to floating-point precision over a long integration`, () => {
        const mass = 1;
        const ctx = (() => {
          const env = new Environment(
            new ConstantAtmosphere(),
            new UniformGravity(),
            new ZeroWind(),
          );
          const params = createSphericalProjectileParams({
            mass,
            radius: 0.05,
            dragCoefficient: new ConstantCd(0),
          });
          return createEvalContext(env, params);
        })();
        const model = createPlanarProjectileModel([new GravityForce()]);
        const y0 = new Float64Array([0, 0, 20, 50]);
        const h = 1e-2;
        const nSteps = 10000;

        const stepper = new VerletStepper(variant);
        stepper.init(model, ctx);
        const y = Float64Array.from(y0);
        const out = createStepResult(4);
        const e0 = mechanicalEnergy(y0, ctx);
        let maxAbsErr = 0;
        let t = 0;
        for (let i = 0; i < nSteps; i++) {
          stepper.step(t, y, h, out);
          y.set(out.yNext);
          t += h;
          maxAbsErr = Math.max(maxAbsErr, Math.abs(mechanicalEnergy(y, ctx) - e0));
        }

        // Constant acceleration makes the q-update's Taylor truncation exact
        // (d^3q/dt^3 = da/dt = 0), so the only error source is floating-point
        // rounding accumulated over nSteps -- boundedly small (~1e-7 in
        // absolute energy at this scale, ~1e-10 relative), not a genuine
        // O(h^2) discretization error that would grow with step count.
        expect(maxAbsErr).toBeLessThan(1e-6);
      });
    }
  });

  describe("harmonic oscillator: slope 2.00 +/- 0.05 (the genuine state-dependent-force convergence check)", () => {
    for (const variant of ["velocity", "position"] as const) {
      it(`${variant} variant`, () => {
        const omega = 2 * Math.PI;
        const x0 = 1;
        const v0 = 0;
        const model = createHarmonicOscillatorModel(omega);
        const ctx = {} as EvalContext;
        const y0 = new Float64Array([x0, v0]);
        const tspan: readonly [number, number] = [0, 1];
        const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];

        const result = measureConvergence(
          () => new VerletStepper(variant),
          model,
          ctx,
          y0,
          tspan,
          (t) => oscillatorExact(omega, x0, v0, t),
          hs,
        );

        expect(result.errors.length).toBe(hs.length);
        for (let i = 1; i < result.errors.length; i++) {
          expect(result.errors[i]!).toBeLessThan(result.errors[i - 1]!);
        }
        expect(result.slope).toBeGreaterThan(1.95);
        expect(result.slope).toBeLessThan(2.05);
      });
    }
  });

  it("harmonic oscillator: velocity-Verlet's bounded energy error over 100 periods is smaller than semi-implicit Euler's at equal h", () => {
    const omega = 2 * Math.PI;
    const stepsPerPeriod = 200;
    const h = 1 / stepsPerPeriod;
    const periods = 100;
    const model = createHarmonicOscillatorModel(omega);
    const ctx = {} as EvalContext;
    const y0 = new Float64Array([1, 0]);

    function maxRelEnergyError(stepper: Stepper): number {
      stepper.init(model, ctx);
      const y = Float64Array.from(y0);
      const out = createStepResult(2);
      const e0 = oscillatorEnergy(omega, y0);
      let maxErr = 0;
      let t = 0;
      for (let i = 0; i < stepsPerPeriod * periods; i++) {
        stepper.step(t, y, h, out);
        y.set(out.yNext);
        t += h;
        maxErr = Math.max(maxErr, Math.abs(oscillatorEnergy(omega, y) / e0 - 1));
      }
      return maxErr;
    }

    const verletErr = maxRelEnergyError(new VerletStepper("velocity"));
    const symplecticEulerErr = maxRelEnergyError(new SemiImplicitEulerStepper());

    expect(verletErr).toBeLessThan(symplecticEulerErr);
  });

  describe("P2.17: velocity-Verlet retains slope 2 on a genuinely velocity-dependent force (quadratic drag)", () => {
    // Quadratic drag has no closed-form trajectory, so this benchmark needs a
    // numerical reference in place of an analytic yExact. P2.18's
    // tight-tolerance reference utility (tight DOPRI5, once P2.24 lands, or
    // Richardson-extrapolated RK4 meanwhile) doesn't exist yet, so a tight
    // fixed-step RK4 run (h=1e-5, global error ~O(h^4) ~ 1e-20 -- many orders
    // below anything measured at the coarser hs below) stands in directly:
    // exactly the "Richardson-extrapolated RK4" fallback §5.1/P2.18 name for
    // problems without analytics, just inlined rather than factored out.
    function projectileModelAndContext(): { model: Model; ctx: EvalContext } {
      const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
      const params = createSphericalProjectileParams({
        mass: 0.145,
        radius: 0.0366,
        dragCoefficient: new ConstantCd(0.5),
      });
      return {
        model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
        ctx: createEvalContext(env, params),
      };
    }

    it("slope 2.00 +/- 0.1 vs tight-RK4 reference (validation criterion; measured ~1.0 before the P2.17 extrapolated-velocity fix)", () => {
      const { model, ctx } = projectileModelAndContext();
      const y0 = new Float64Array([0, 0, 30, 40]);
      const tspan: readonly [number, number] = [0, 1];

      const refStepper = new ClassicalRK4Stepper();
      const refReport = integrate(
        model,
        ctx,
        y0,
        tspan,
        { stepper: refStepper.info.id, h: 1e-5, maxSteps: Number.MAX_SAFE_INTEGER },
        refStepper,
        [],
      );
      const yRef = refReport.yFinal;

      const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];
      const result = measureConvergence(
        () => new VerletStepper("velocity"),
        model,
        ctx,
        y0,
        tspan,
        () => yRef,
        hs,
      );

      expect(result.errors.length).toBe(hs.length);
      for (let i = 1; i < result.errors.length; i++) {
        expect(result.errors[i]!).toBeLessThan(result.errors[i - 1]!);
      }
      // Validation criterion (P2.17): slope 2 retained on the quadratic-drag
      // benchmark vs. the tight reference above.
      expect(result.slope).toBeGreaterThan(1.9);
      expect(result.slope).toBeLessThan(2.1);
    });
  });

  describe("partitioned dims with an extra scalar state (P4.10)", () => {
    const oscOmega = 2 * Math.PI;
    const tauOmega = 5;
    const x0 = 1;
    const v0 = 0;
    const omega0 = 300;
    const tspan: readonly [number, number] = [0, 1];
    const hs = [0.02, 0.01, 0.005, 0.0025, 0.00125];

    for (const variant of ["velocity", "position"] as const) {
      it(`${variant} variant: the partitioned (q, p) channels retain slope 2 with an extra unpartitioned channel present`, () => {
        const model = createOscillatorWithSpinModel(oscOmega, tauOmega);
        const ctx = {} as EvalContext;
        const y0 = new Float64Array([x0, v0, omega0]);

        const result = measureConvergence(
          () => new VerletStepper(variant),
          model,
          ctx,
          y0,
          tspan,
          (t) => oscillatorWithSpinExact(oscOmega, tauOmega, x0, v0, omega0, t),
          hs,
          qpErrorNorm,
        );

        expect(result.slope).toBeGreaterThan(1.95);
        expect(result.slope).toBeLessThan(2.05);
      });

      it(`${variant} variant: the unpartitioned omega channel is advanced by a companion first-order (Euler) step, slope 1`, () => {
        const model = createOscillatorWithSpinModel(oscOmega, tauOmega);
        const ctx = {} as EvalContext;
        const y0 = new Float64Array([x0, v0, omega0]);

        const result = measureConvergence(
          () => new VerletStepper(variant),
          model,
          ctx,
          y0,
          tspan,
          (t) => oscillatorWithSpinExact(oscOmega, tauOmega, x0, v0, omega0, t),
          hs,
          omegaErrorNorm,
        );

        expect(result.slope).toBeGreaterThan(0.9);
        expect(result.slope).toBeLessThan(1.1);
      });
    }
  });
});
