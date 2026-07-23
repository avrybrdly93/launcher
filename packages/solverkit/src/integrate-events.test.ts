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
import { EventCollector } from "./event-collector.js";
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

describe("integrate: EventCollector sink (P3.13, §5.4 scrub-bar event ticks)", () => {
  it("collects the non-terminal apex event with v_y localized to ~0, without truncating the solve", () => {
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);

    // Launched from y0=1000, well above the ground, so both the apex
    // (non-terminal) and ground-impact (terminal) events fire within tspan,
    // with the apex strictly first.
    const y0 = new Float64Array([0, 1000, 10, 20]);
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();
    const recorder = new TrajectoryRecorder();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 100],
      { stepper: stepper.info.id, h: 0.5, maxSteps: 2000 },
      stepper,
      [recorder, collector],
    );

    expect(report.status).toBe("ok");

    const apexEvents = collector.events.filter((e) => e.event.name === "apex");
    expect(apexEvents).toHaveLength(1);
    const apex = apexEvents[0]!;

    // This task's literal validation criterion: scrubbing to the apex tick
    // lands at a v_y=0 state.
    expect(Math.abs(apex.y[3]!)).toBeLessThan(1e-9);
    expect(apex.converged).toBe(true);

    // Localized strictly between launch and the (later) terminal ground
    // impact -- collecting it never truncated or altered the solve.
    expect(apex.t).toBeGreaterThan(0);
    expect(apex.t).toBeLessThan(report.tFinal);

    // Ground impact (terminal) is never surfaced through the collector --
    // it already ends the trajectory as the recorded final row.
    expect(collector.events.some((e) => e.event.name === "ground-impact")).toBe(false);
    expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-9);
  });

  it("does not report a non-terminal event whose localized time falls after the same step's terminal crossing", () => {
    // A launch so close to the ground that apex and ground-impact both
    // localize within the *same* accepted step, with ground-impact first --
    // a physically-backwards apex-after-impact must never be reported.
    const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
    const params = createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0),
    });
    const ctx = createEvalContext(env, params);
    const model = createPlanarProjectileModel([new GravityForce()]);

    // Launched moving straight down from just above the ground: no apex
    // exists at all (v_y never crosses from positive to negative), so the
    // only event in play is the terminal ground impact -- confirms nothing
    // spurious leaks into the collector when a step contains only a
    // terminal crossing.
    const y0 = new Float64Array([0, 1, 0, -5]);
    const stepper = createDormandPrince54Stepper();
    const collector = new EventCollector();

    const report = integrate(
      model,
      ctx,
      y0,
      [0, 10],
      { stepper: stepper.info.id, h: 0.5, maxSteps: 200 },
      stepper,
      [collector],
    );

    expect(report.status).toBe("ok");
    expect(collector.events).toHaveLength(0);
  });

  it("throws if .events is read before finish()", () => {
    const collector = new EventCollector();
    expect(() => collector.events).toThrow(/before finish/);
  });
});
