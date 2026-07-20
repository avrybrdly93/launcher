import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  mechanicalEnergy,
  type EvalContext,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { HeunRK2Stepper } from "./heun-rk2-stepper.js";
import { integrate } from "./integrate.js";
import { InvariantMonitor } from "./invariant-monitor.js";
import type { SolverConfig, Stepper } from "./types.js";

function createEvalContextFixture(): EvalContext {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.145,
    radius: 0.037,
    dragCoefficient: new ConstantCd(0.5),
  });
  return createEvalContext(env, params);
}

const Y0 = new Float64Array([0, 50, 30, 8]);

/** Least-squares slope of log(error) vs log(h) (mirrors convergence-harness.ts's fitSlope). */
function fitOrder(hs: readonly number[], errors: readonly number[]): number {
  const xs = hs.map(Math.log);
  const ys = errors.map(Math.log);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - meanX;
    covariance += dx * (ys[i]! - meanY);
    variance += dx * dx;
  }
  return covariance / variance;
}

/** Largest |residual| over the whole recorded channel -- robust to the trend crossing zero mid-run. */
function maxAbsResidual(monitor: InvariantMonitor): number {
  const { residual } = monitor.channel;
  let maxAbs = 0;
  for (let i = 0; i < residual.length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(residual[i]!));
  }
  return maxAbs;
}

describe("InvariantMonitor (P2.37)", () => {
  it("drag-off: max|R_E(t)| stays below 1e-12 * E0 over the whole solve", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = createEvalContextFixture();
    const stepper = createDormandPrince54Stepper();
    const monitor = new InvariantMonitor(model, ctx, stepper);
    const cfg: SolverConfig = { stepper: stepper.info.id, h: 0.05, maxSteps: 100_000 };

    // E0 from the same evaluate() path the monitor itself uses, snapshotted
    // before integrate() advances ctx's environment sample past t=0.
    model.rhs(0, Y0, new Float64Array(model.dim), ctx);
    const e0 = mechanicalEnergy(Y0, ctx);

    const report = integrate(model, ctx, Y0, [0, 3], cfg, stepper, [monitor]);
    expect(report.status).toBe("ok");
    expect(monitor.channel.t.length).toBeGreaterThan(1);
    expect(maxAbsResidual(monitor)).toBeLessThan(1e-12 * Math.abs(e0));
  });

  it("throws when the model declares no invariant of the requested name", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = createEvalContextFixture();
    const stepper = createDormandPrince54Stepper();
    expect(() => new InvariantMonitor(model, ctx, stepper, "angular-momentum")).toThrow();
  });

  it("throws when the requested invariant declares no power()", () => {
    const model = createPlanarProjectileModel([new GravityForce()]);
    const ctx = createEvalContextFixture();
    const stepper = createDormandPrince54Stepper();
    expect(() => new InvariantMonitor(model, ctx, stepper, "momentum-x")).toThrow();
  });

  it("drag-on: max|R_E(t)| shrinks under h-refinement at a rate matching the stepper's order", () => {
    function measureOrder(
      createStepper: () => Stepper,
      hs: readonly number[],
    ): { readonly errors: readonly number[]; readonly slope: number } {
      const errors = hs.map((h) => {
        const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
        const ctx = createEvalContextFixture();
        const inner = createStepper();
        const stepper =
          inner.interpolant !== undefined ? inner : new HermiteDenseOutputStepper(inner);
        const monitor = new InvariantMonitor(model, ctx, stepper);
        const cfg: SolverConfig = { stepper: stepper.info.id, h, maxSteps: 1_000_000 };

        const report = integrate(model, ctx, Y0, [0, 1], cfg, stepper, [monitor]);
        expect(report.status).toBe("ok");
        return maxAbsResidual(monitor);
      });

      return { errors, slope: fitOrder(hs, errors) };
    }

    // h grids are per-stepper: DOPRI5 (order 5) converges so fast that h
    // below ~0.02 pushes max|R_E| down into float64 round-off noise (~1e-13),
    // which would flatten the measured slope regardless of the method's true
    // order -- each grid stays in the truncation-error-dominated regime.
    const cases: readonly [string, () => Stepper, readonly number[]][] = [
      ["explicit-euler (order 1)", () => new ExplicitEulerStepper(), [0.04, 0.02, 0.01, 0.005]],
      ["heun-rk2 (order 2)", () => new HeunRK2Stepper(), [0.04, 0.02, 0.01, 0.005]],
      ["classical-rk4 (order 4)", () => new ClassicalRK4Stepper(), [0.08, 0.04, 0.02, 0.01]],
      ["dopri5 (order 5)", () => createDormandPrince54Stepper(), [0.08, 0.04, 0.02, 0.01]],
    ];
    const orders = [1, 2, 4, 5];

    cases.forEach(([label, createStepper, hs], i) => {
      const { errors, slope } = measureOrder(createStepper, hs);
      const order = orders[i]!;
      expect(
        slope,
        `${label}: observed order ${slope.toFixed(2)} from errors ${errors.map((e) => e.toExponential(2)).join(", ")}`,
      ).toBeGreaterThan(order - 0.5);
    });
  });
});
