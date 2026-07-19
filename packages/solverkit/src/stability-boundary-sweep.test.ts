import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  LinearDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
  dragRelaxationTimeLinear,
  sutherlandViscosity,
  ISA,
  type CharacteristicEnvironment,
} from "@ballista/engine";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { bisectCriticalStepSize, isStepperStable } from "./stability-boundary-sweep.js";

const VX = 2;

/**
 * P1.36's dust-grain preset projectile (5-micron mineral-dust grain,
 * density 2000 kg/m^3): the platform's canonical stiffness demonstration
 * (§3.8), reused here rather than redefined, since this task audits the
 * exact preset the blueprint names.
 */
function createDustGrainParams() {
  const radius = 5e-6;
  const mass = (4 / 3) * Math.PI * Math.pow(radius, 3) * 2000;
  return createSphericalProjectileParams({ mass, radius, dragCoefficient: new ConstantCd(0.5) });
}

describe("stability boundary sweep (P2.22)", () => {
  it("bisects Euler's h_crit on the dust-grain scenario within 20% of the (4.12) prediction", () => {
    const params = createDustGrainParams();
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce(), new LinearDragForce()]);
    const stepper = new ExplicitEulerStepper();

    // Stokes drag makes the vx channel an exact, unforced linear recursion
    // (no gravity component acts on x): dv_x/dt = -v_x/tau, so its Dahlquist
    // eigenvalue lambda = -1/tau is exact, not a linearization approximation,
    // and vx's fixed point is exactly 0 -- the cleanest possible channel to
    // bisect stability on.
    const charEnv: CharacteristicEnvironment = { rho: ISA.rho0, eta: sutherlandViscosity(ISA.T0) };
    const tau = dragRelaxationTimeLinear(params, charEnv);
    const predictedHCrit = 2 * tau; // §4.6: h < 2/|lambda_max| for explicit Euler

    const y0 = new Float64Array([0, 0.01, 15, 0]); // P1.36 dust-grain preset ICs (x0, y0, vx0, vy0)
    const nSteps = 20;

    function isStable(h: number): boolean {
      return isStepperStable(stepper, model, ctx, y0, h, nSteps, VX);
    }

    const result = bisectCriticalStepSize(isStable, tau * 0.5, tau * 10);

    expect(result.hCrit).toBeGreaterThan(predictedHCrit * 0.8);
    expect(result.hCrit).toBeLessThan(predictedHCrit * 1.2);
  });

  it("throws on an invalid bracket instead of returning a meaningless answer", () => {
    const alwaysStable = () => true;
    const alwaysUnstable = () => false;
    expect(() => bisectCriticalStepSize(alwaysUnstable, 1, 2)).toThrow();
    expect(() => bisectCriticalStepSize(alwaysStable, 1, 2)).toThrow();
  });
});
