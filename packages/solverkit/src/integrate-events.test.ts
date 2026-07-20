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
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { integrate } from "./integrate.js";
import { TrajectoryRecorder } from "./trajectory-recorder.js";

describe("integrate: terminal-event step truncation (P2.34, §4.9 step 3)", () => {
  /**
   * This task's literal validation criterion: a projectile launched above
   * flat terrain (y0=10) with a `tspan` reaching far past its natural
   * impact time must stop *exactly* at the ground, not overshoot into
   * negative `y` and not merely land close by whatever step size happened
   * to bracket it.
   */
  it("trajectory ends exactly at y=0 (|y_impact| < 1e-10)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);

    const y0 = new Float64Array([0, 10, 15, 8]);
    const stepper = createDormandPrince54Stepper();
    const recorder = new TrajectoryRecorder();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 100],
      { stepper: stepper.info.id, h: 0.5, maxSteps: 1000 },
      stepper,
      [recorder],
    );

    expect(report.status).toBe("ok");
    expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-10);
    // Terminated well before the requested t_f=100 -- proof the event, not
    // the tspan, ended the solve.
    expect(report.tFinal).toBeLessThan(100);
    expect(report.tFinal).toBeGreaterThan(0);

    // The recorded trajectory's last row is the exact truncated event
    // state, not the overshot pre-truncation step.
    const traj = recorder.trajectory;
    expect(traj.t[traj.nSteps - 1]).toBe(report.tFinal);
    expect(Math.abs(traj.channels[1]![traj.nSteps - 1]!)).toBeLessThan(1e-10);
  });

  it("a non-terminal event (apex) does not truncate the solve", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);

    // Launch from high enough (y0=1000) that the apex (v_y=0, well inside
    // the tspan) fires but the ground-impact event never does.
    const y0 = new Float64Array([0, 1000, 10, 5]);
    const stepper = createDormandPrince54Stepper();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 1],
      { stepper: stepper.info.id, h: 0.1, maxSteps: 100 },
      stepper,
    );

    expect(report.status).toBe("ok");
    // Reached the full requested t_f -- the apex crossing did not stop it.
    expect(report.tFinal).toBe(1);
  });

  it("a model with no declared events integrates unaffected (backward compatible)", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const fullModel = createPlanarProjectileModel([new GravityForce()]);
    const model = { ...fullModel, events: [] };

    const y0 = new Float64Array([0, 5, 10, 0]);
    const stepper = createDormandPrince54Stepper();
    const report = integrate(
      model,
      ctx,
      y0,
      [0, 0.05],
      { stepper: stepper.info.id, h: 0.01, maxSteps: 10 },
      stepper,
    );

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(0.05);
  });
});
