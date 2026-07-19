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
  ISA,
} from "@ballista/engine";
import {
  ExplicitEulerStepper,
  bisectStabilityBoundary,
  eulerLinearStabilityLimit,
  integrate,
} from "@ballista/solverkit";
import type { SolverConfig } from "@ballista/solverkit";

// State layout of createPlanarProjectileModel: [x, y, vx, vy] (planar-projectile-model.ts).
const VX = 2;

/**
 * Dust-grain-like projectile (P1.36's mass/radius, same launch speed) wired
 * with quadratic drag rather than the preset's physically-correct Stokes/
 * linear drag: eq. (4.12) is specifically a quadratic-drag stability
 * prediction (linearizing eq. 3.8), so exercising it needs the quadratic
 * force wired, exactly as P1.36's own note already flags this projectile's
 * Cd=0.5 as "only a nominal reference value" for this kind of exhibit.
 * Gravity is included (the real scenario's force set) but contributes
 * nothing to the velocity-block Jacobian (P1.22): it's position/velocity-
 * independent, so it cannot affect Euler's stability boundary either way.
 */
function createDustGrainQuadraticDragFixture() {
  const mass = 1.0472e-12;
  const radius = 5e-6;
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass,
    radius,
    dragCoefficient: new ConstantCd(0.5),
  });
  const ctx = createEvalContext(env, params);
  const y0 = new Float64Array([0, 0.01, 15, 0]); // P1.36 DUST_GRAIN's own initial conditions
  return { model, ctx, y0, mass, radius, cd: 0.5, rho: ISA.rho0 };
}

/**
 * Euler stability boundary measured directly on the real (nonlinear)
 * dust-grain rhs, not a hand-typed formula: runs one Euler step from `y0`
 * and from `y0` perturbed by a tiny `eps` along vx (the streamwise
 * direction eq. 4.12 calls out as the more restrictive of the velocity-
 * block eigenvalues), and asks whether the *difference* between the two
 * one-step results grew relative to `eps`.
 *
 * This is the textbook-correct thing to bisect for a nonlinear rhs --
 * "Euler stability" is fundamentally a statement about how a numerical
 * *perturbation* (error) propagates under repeated steps, i.e. the
 * behavior of the (frozen or evolving) Jacobian's linearization, not about
 * whether the raw state itself stays bounded. The two are NOT the same
 * question here: bisecting on the raw state's own long-run trajectory
 * (u decaying to the degenerate zero fixed point of a pure |v|v power law)
 * was verified by hand to converge to 4/|lambda|, 2x this function's
 * answer, because the exact one-step amplification of a quadratic
 * nonlinearity's *own value* is governed by the secant slope f(u)/u, not
 * the tangent slope f'(u) = lambda -- a real, exactly-derivable factor
 * that's specific to raw-state bisection and irrelevant to the standard
 * error-propagation definition of stiffness this function measures. To
 * O(eps), the perturbation obeys `delta_1 ~= (I + h*J(y0)) * delta_0`
 * exactly, recovering the ordinary Dahlquist story for J's eigenvalues.
 */
function isEulerStable(
  model: ReturnType<typeof createPlanarProjectileModel>,
  ctx: ReturnType<typeof createEvalContext>,
  y0: Float64Array,
  h: number,
): boolean {
  const eps = 1e-9;
  const yPert0 = Float64Array.from(y0);
  yPert0[VX] = yPert0[VX]! + eps;

  const cfg: SolverConfig = { stepper: "explicit-euler", h, maxSteps: 2 };
  const report = integrate(model, ctx, y0, [0, h], cfg, new ExplicitEulerStepper());
  const reportPert = integrate(model, ctx, yPert0, [0, h], cfg, new ExplicitEulerStepper());

  let sumSq = 0;
  for (let i = 0; i < y0.length; i++) {
    const d = reportPert.yFinal[i]! - report.yFinal[i]!;
    sumSq += d * d;
  }
  const deltaNorm = Math.sqrt(sumSq);
  return report.status === "ok" && reportPert.status === "ok" && deltaNorm <= eps;
}

describe("Automated stability-boundary sweep (P2.22)", () => {
  it("measured h_crit on the dust-grain quadratic-drag scenario matches 2/|lambda_max| (the corrected eq. 4.12)", () => {
    const { model, ctx, y0, mass, radius, cd, rho } = createDustGrainQuadraticDragFixture();
    const area = Math.PI * radius * radius;
    const uMax = y0[VX]!; // drag only decelerates, so the launch speed is the max over the flight

    // Read lambda_max from the model's own analytic Jacobian (P1.22) rather
    // than re-deriving the formula by hand, so this test catches a genuine
    // RHS/Jacobian regression (§8.3's stated intent for this audit).
    expect(model.jacobian).toBeDefined();
    const jac = new Float64Array(16);
    model.jacobian!(0, y0, ctx, jac);
    const lambdaMax = jac[VX * 4 + VX]!;
    expect(lambdaMax).toBeCloseTo(-(rho * cd * area * uMax) / mass, 6); // eq. 4.12's own stated formula

    const predictedHCrit = eulerLinearStabilityLimit(lambdaMax);

    const measuredHCrit = bisectStabilityBoundary(
      (h) => isEulerStable(model, ctx, y0, h),
      predictedHCrit / 4,
      predictedHCrit * 4,
      { relTol: 1e-8 },
    );

    // Validation criterion: h_crit within 20% of the (corrected) eq. 4.12
    // prediction. In practice this lands within a fraction of a percent --
    // to O(eps) the perturbation genuinely obeys the frozen-Jacobian linear
    // ODE, so there's no nonlinear correction left to account for.
    const relError = Math.abs(measuredHCrit - predictedHCrit) / predictedHCrit;
    expect(relError).toBeLessThan(0.2);
    expect(relError).toBeLessThan(0.01); // tighter bound the mechanism actually achieves

    // Documents the blueprint's eq. (4.12) as-printed typo: "h < 2/|lambda|_max
    // = m/(rho Cd A u_max)" is not a valid simplification given the blueprint's
    // own lambda = -rho Cd A u/m (streamwise) -- 2/|lambda_max| algebraically
    // equals 2m/(rho Cd A u_max), not m/(rho Cd A u_max); the printed RHS is
    // missing a factor of 2, confirmed here against the model's real Jacobian.
    const asPrintedEq412 = mass / (rho * cd * area * uMax);
    expect(measuredHCrit / asPrintedEq412).toBeCloseTo(2, 1);
  });
});
