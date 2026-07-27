import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileSpinModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { integrate } from "./integrate.js";

/**
 * P4.07 validation criterion: the dim-5 spin-decay model's omega channel
 * matches the closed-form solution of omega_dot = -omega/tau,
 * omega(t) = omega0*exp(-t/tau), to 1e-10. No aerodynamic forces are wired
 * (translational motion is drag-free, gravity-only) so this isolates the
 * spin-decay rhs row from any coupling through the Magnus force.
 */
describe("planarProjectileSpinModel: omega(t) = omega0*exp(-t/tau) (P4.07, eq. in §3.6)", () => {
  it("matches the closed-form decay to 1e-10 absolute error over a 10s flight", () => {
    const tauOmega = 25; // typical sport-ball spin-decay time (§3.6)
    const omega0 = 300; // rad/s, golf-drive-like backspin
    const model = createPlanarProjectileSpinModel([], tauOmega);

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    const y0 = new Float64Array([0, 0, 0, 0, omega0]);
    const stepper = new ClassicalRK4Stepper();
    const tFinal = 10;

    const report = integrate(
      model,
      ctx,
      y0,
      [0, tFinal],
      { stepper: stepper.info.id, h: 1e-3, maxSteps: 20_000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    const expected = omega0 * Math.exp(-tFinal / tauOmega);
    expect(Math.abs(report.yFinal[4]! - expected)).toBeLessThan(1e-10);
  });

  it("halves in the time predicted by the closed form (tau*ln2), independent of tauOmega", () => {
    const tauOmega = 8;
    const omega0 = 150;
    const model = createPlanarProjectileSpinModel([], tauOmega);

    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);

    const y0 = new Float64Array([0, 0, 0, 0, omega0]);
    const stepper = new ClassicalRK4Stepper();
    const tHalf = tauOmega * Math.LN2;

    const report = integrate(
      model,
      ctx,
      y0,
      [0, tHalf],
      { stepper: stepper.info.id, h: 1e-3, maxSteps: 20_000 },
      stepper,
    );

    expect(report.status).toBe("ok");
    expect(report.yFinal[4]).toBeCloseTo(omega0 / 2, 8);
  });
});
