import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { ClassicalRK4Stepper } from "./classical-rk4-stepper.js";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import { EventCollector } from "./event-collector.js";
import { ExplicitEulerStepper } from "./explicit-euler-stepper.js";
import { HeunRK2Stepper } from "./heun-rk2-stepper.js";
import { HermiteDenseOutputStepper } from "./hermite-dense-output.js";
import { integrate } from "./integrate.js";
import { MidpointRK2Stepper } from "./midpoint-rk2-stepper.js";
import type { Stepper } from "./types.js";

/**
 * P0.99 / ADR-016 -- CHARACTERIZATION, NOT A PASSING SPEC.
 *
 * `integrate` folds "the stepper exposes an interpolant" into its `hasEvents`
 * predicate, so a model that declares events combined with a stepper that
 * cannot localize them integrates as though it declared none: no warning, no
 * failure, `status: "ok"`, projectile through the ground.
 *
 * P0.99 remains OPEN. These tests exist so the numbers in the bug report stay
 * true as the code moves, and -- more importantly -- so the two obvious
 * "fixes" cannot be applied without a test going red and pointing at ADR-016.
 * The 27th run implemented the throw and measured what it costs: 88 tests
 * across 31 files, because fixed-step integration of an event-bearing model
 * is how every convergence-order study, energy-drift study and golden
 * trajectory in this repo works. The last test here pins that pattern, so it
 * is visible from the same file as the bug it appears to justify.
 */

/** Drag-free planar model. `createPlanarProjectileModel` always attaches a ground-impact event. */
function setup() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()]);
  return { ctx, model };
}

/** The exact configuration recorded in P0.99's repro. */
const Y0 = () => new Float64Array([0, 5, 3, 0]);
const TSPAN: readonly [number, number] = [0, 12];
const H = 0.12;

function run(stepper: Stepper, collector?: EventCollector) {
  const { ctx, model } = setup();
  return integrate(
    model,
    ctx,
    Y0(),
    TSPAN,
    { stepper: stepper.info.id, h: H, maxSteps: 5000 },
    stepper,
    collector ? [collector] : [],
  );
}

describe("integrate: event detection silently disabled without dense output (P0.99, open)", () => {
  it("DOPRI5 supplies its own interpolant, so the terminal ground impact stops the solve", () => {
    const collector = new EventCollector();
    const report = run(createDormandPrince54Stepper(), collector);

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBeCloseTo(1.00981, 5);
    expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-9);
    expect(collector.events.length).toBeGreaterThanOrEqual(1);
  });

  it("BUG: ClassicalRK4 has no interpolant, so the same solve reports ok 701 m underground", () => {
    const collector = new EventCollector();
    const report = run(new ClassicalRK4Stepper(), collector);

    // Every one of these assertions is the bug, not the specification. When
    // P0.99 is fixed this test must be rewritten, not deleted -- read
    // ADR-016 first.
    expect(report.status).toBe("ok");
    expect(report.tFinal).toBe(TSPAN[1]);
    expect(report.yFinal[1]!).toBeLessThan(-700);
    expect(collector.events).toHaveLength(0);
  });

  const fixedStepSteppers: readonly [string, () => Stepper][] = [
    ["ExplicitEulerStepper", () => new ExplicitEulerStepper()],
    ["HeunRK2Stepper", () => new HeunRK2Stepper()],
    ["MidpointRK2Stepper", () => new MidpointRK2Stepper()],
  ];

  for (const [name, make] of fixedStepSteppers) {
    it(`BUG generalises to ${name}: no interpolant, no events, still ok below ground`, () => {
      const stepper = make();
      // Guards the premise: if this stepper ever gains dense output, this
      // line fails rather than the test passing for the wrong reason.
      expect(stepper.interpolant).toBeUndefined();

      const collector = new EventCollector();
      const report = run(stepper, collector);
      expect(report.status).toBe("ok");
      expect(report.yFinal[1]!).toBeLessThan(0);
      expect(collector.events).toHaveLength(0);
    });
  }

  it("the workaround works today and needs no core change: wrap the fixed step for dense output", () => {
    const collector = new EventCollector();
    const report = run(new HermiteDenseOutputStepper(new ClassicalRK4Stepper()), collector);

    expect(report.status).toBe("ok");
    expect(report.tFinal).toBeLessThan(TSPAN[1]);
    expect(collector.events.length).toBeGreaterThanOrEqual(1);
    // At the ground, not through it.
    expect(Math.abs(report.yFinal[1]!)).toBeLessThan(1e-6);
    // Drag-free from y = 5 with v_y = 0 gives t_impact = sqrt(2*5/g). Cubic
    // Hermite is 3rd order, so this is loose but real: the localized time is
    // the physical one, not an artefact of the wrapper.
    expect(report.tFinal).toBeCloseTo(Math.sqrt((2 * 5) / 9.80665), 3);
  });

  it("WHY THE OBVIOUS FIX IS WRONG: a fixed step on an event-bearing model is the normal case here", () => {
    // Convergence-order and energy-drift studies must hold h fixed, and every
    // standard projectile model declares a ground-impact event, so this
    // combination is not a caller mistake -- it is the majority of the
    // numerical-methods content in this repo. Throwing on it took 88 tests
    // across 31 files red on the 27th run. Auto-wrapping in
    // HermiteDenseOutputStepper is worse: it would arm the terminal event and
    // truncate exactly these studies at ground impact, silently changing
    // every convergence and energy measurement they report.
    const { ctx, model } = setup();
    const stepper = new ClassicalRK4Stepper();
    const report = integrate(
      model,
      ctx,
      new Float64Array([0, 0, 20, 50]),
      [0, 1],
      { stepper: stepper.info.id, h: 1e-2, maxSteps: 5000 },
      stepper,
      [],
    );

    // Runs the whole requested span, undisturbed, which is what such a study
    // needs. It never goes near the ground, so no event should fire anyway.
    expect(report.status).toBe("ok");
    expect(report.tFinal).toBeCloseTo(1, 9);
    expect(report.yFinal[1]!).toBeGreaterThan(0);
  });
});
