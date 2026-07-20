import { describe, expect, it } from "vitest";
import {
  ConstantAtmosphere,
  Environment,
  GravityForce,
  QuadraticDragForce,
  TabulatedReynoldsCd,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "./dormand-prince-54.js";
import {
  attemptAdaptivePIStep,
  DEFAULT_PI_CONTROLLER,
  INITIAL_PI_ERROR,
  piControllerFactor,
} from "./pi-controller.js";
import { integrate } from "./integrate.js";
import { createStepResult, StepSizeUnderflowError, type SolverConfig } from "./types.js";

describe("piControllerFactor (P2.28, eq. 4.10 PI variant)", () => {
  it("matches the hand-computed formula at errK=errKMinus1=1 (raw factor, no clamp)", () => {
    // alpha = beta = 0.1 for embeddedOrder=4 (0.7/4, 0.4/4); raw = 0.9 * 1^-0.175 * 1^0.1 = 0.9.
    expect(piControllerFactor(1, 1, 4)).toBeCloseTo(0.9, 15);
  });

  it("matches the hand-computed formula for a small errK with neutral history", () => {
    // alpha = 0.175; raw = 0.9 * 0.001^-0.175 * 1^0.1 = 0.9 * 1000^0.175.
    const expected = 0.9 * Math.pow(1000, 0.175);
    expect(piControllerFactor(0.001, 1, 4)).toBeCloseTo(expected, 12);
  });

  it("a small previous error (errKMinus1 < 1) further shrinks the proposal relative to neutral history", () => {
    const neutral = piControllerFactor(0.5, 1, 4);
    const withSmallHistory = piControllerFactor(0.5, 0.01, 4);
    // errKMinus1^beta with errKMinus1 < 1 and beta > 0 is < 1, damping growth.
    expect(withSmallHistory).toBeLessThan(neutral);
  });

  it("a large previous error (errKMinus1 > 1) further grows the proposal relative to neutral history", () => {
    const neutral = piControllerFactor(0.5, 1, 4);
    const withLargeHistory = piControllerFactor(0.5, 100, 4);
    expect(withLargeHistory).toBeGreaterThan(neutral);
  });

  it("clamps a large errK's shrink to minFactor", () => {
    expect(piControllerFactor(1e12, 1, 4)).toBeCloseTo(DEFAULT_PI_CONTROLLER.minFactor, 15);
  });

  it("clamps growth to maxFactor", () => {
    expect(piControllerFactor(1e-12, 1e-12, 4)).toBeCloseTo(DEFAULT_PI_CONTROLLER.maxFactor, 15);
  });

  it("resolves a perfect step (errK=0, raw=Infinity) to the growth cap, not NaN", () => {
    expect(piControllerFactor(0, 1, 4)).toBe(DEFAULT_PI_CONTROLLER.maxFactor);
  });
});

function makeDragModel() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new TabulatedReynoldsCd(),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  return { model, ctx };
}

describe("attemptAdaptivePIStep (P2.28)", () => {
  it("accepts a loose-tolerance step in a single attempt and proposes hNext blending errK and errPrev", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const out = createStepResult(4);
    const outcome = attemptAdaptivePIStep(
      stepper,
      4,
      0,
      y,
      0.01,
      1e-3,
      1e-6,
      INITIAL_PI_ERROR,
      out,
    );

    expect(outcome.rejections).toBe(0);
    expect(outcome.h).toBe(0.01);
    expect(outcome.hNext).toBeGreaterThan(0);
    expect(outcome.errAccepted).toBeGreaterThanOrEqual(0);
    expect(out.accepted).toBe(true);
  });

  it("rejects an oversized step, shrinks h, and eventually accepts a smaller one", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const out = createStepResult(4);
    const outcome = attemptAdaptivePIStep(stepper, 4, 0, y, 5, 1e-8, 1e-10, INITIAL_PI_ERROR, out);

    expect(outcome.rejections).toBeGreaterThan(0);
    expect(outcome.h).toBeLessThan(5);
    expect(out.accepted).toBe(true);
  });

  it("never advances y on a rejected attempt -- each retry starts from the same (t, y)", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const yBefore = Float64Array.from(y);
    const out = createStepResult(4);
    attemptAdaptivePIStep(stepper, 4, 0, y, 5, 1e-8, 1e-10, INITIAL_PI_ERROR, out);

    expect(y).toEqual(yBefore);
  });

  it("a smaller errPrev fed into the same attempt yields a smaller hNext than a neutral-history call at the same errK", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const out = createStepResult(4);
    // h=2 lands errAccepted well inside (0, 1), away from both the accept
    // boundary and the maxFactor clamp, so the errPrev term's effect on
    // hNext is actually visible instead of being swallowed by a clamp.
    const neutral = attemptAdaptivePIStep(stepper, 4, 0, y, 2, 1e-3, 1e-6, INITIAL_PI_ERROR, out);
    const withTinyHistory = attemptAdaptivePIStep(stepper, 4, 0, y, 2, 1e-3, 1e-6, 1e-10, out);

    // Same errK (same t, y, h, tolerance) each time -- only errPrev differs.
    expect(withTinyHistory.hNext).toBeLessThan(neutral.hNext);
  });

  it("P2.29: throws a typed StepSizeUnderflowError, not a generic Error, once a rejection would shrink h below hMin", () => {
    const { model, ctx } = makeDragModel();
    const stepper = createDormandPrince54Stepper();
    stepper.init(model, ctx);

    const y = new Float64Array([0, 1, 20, 10]);
    const out = createStepResult(4);
    let caught: unknown;
    try {
      attemptAdaptivePIStep(
        stepper,
        4,
        0,
        y,
        5,
        1e-12,
        1e-14,
        INITIAL_PI_ERROR,
        out,
        DEFAULT_PI_CONTROLLER,
        1,
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(StepSizeUnderflowError);
    expect((caught as StepSizeUnderflowError).t).toBe(0);
    expect((caught as StepSizeUnderflowError).y).toBe(y);
  });
});

/**
 * Drag-crisis scenario (§4.5's own worked exhibit): a projectile whose
 * velocity sweeps through Re ~ 2e5-3e5 during flight, where
 * {@link TabulatedReynoldsCd} (P1.12) drops sharply from ~0.4 to ~0.1
 * (`SMOOTH_SPHERE_CD_TABLE`, drag-coefficient.ts). The resulting rapid swing
 * in local error step to step is exactly what makes the I controller (P2.27)
 * chatter (accept, reject, accept, reject...) and what the PI controller's
 * error-history term is meant to damp (task validation criterion).
 */
function dragCrisisScenario() {
  const env = new Environment(new ConstantAtmosphere(), new UniformGravity(), new ZeroWind());
  const params = createSphericalProjectileParams({
    mass: 0.1,
    radius: 0.2,
    dragCoefficient: new TabulatedReynoldsCd(),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]);
  const y0 = new Float64Array([0, 40, 30, 3]);
  const tspan: readonly [number, number] = [0, 8];
  return { model, ctx, y0, tspan };
}

describe("integrate() controller selection on the drag-crisis scenario (P2.28)", () => {
  it("PI controller (cfg.controller='PI') rejects >=30% fewer steps than the I controller (cfg.controller unset/'I')", () => {
    const { model, ctx, y0, tspan } = dragCrisisScenario();
    const rtol = 1e-6;
    const atol = 1e-8;
    const h = 0.05;

    const iStepper = createDormandPrince54Stepper();
    const iCfg: SolverConfig = {
      stepper: iStepper.info.id,
      rtol,
      atol,
      h,
      maxSteps: Number.MAX_SAFE_INTEGER,
    };
    const iReport = integrate(model, ctx, y0, tspan, iCfg, iStepper);

    const piStepper = createDormandPrince54Stepper();
    const piCfg: SolverConfig = {
      stepper: piStepper.info.id,
      rtol,
      atol,
      h,
      controller: "PI",
      maxSteps: Number.MAX_SAFE_INTEGER,
    };
    const piReport = integrate(model, ctx, y0, tspan, piCfg, piStepper);

    expect(iReport.status).toBe("ok");
    expect(piReport.status).toBe("ok");
    // Both controllers solve the same physics to the same tight tolerance,
    // so they should land at essentially the same final state...
    expect(Math.abs(iReport.yFinal[1]! - piReport.yFinal[1]!)).toBeLessThan(1e-4);
    // ...while the PI controller's history term suppresses chatter: this
    // scenario's I controller does hit real rejections (not a vacuous 0-vs-0
    // pass), and the PI controller cuts that count by at least 30%.
    expect(iReport.nRejected).toBeGreaterThan(0);
    expect(piReport.nRejected).toBeLessThanOrEqual(iReport.nRejected * 0.7);
  });
});
