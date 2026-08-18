import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { levenbergMarquardt, shootingWithFallback } from "./levenberg-marquardt.js";
import { newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { shootingJacobian } from "./shooting-jacobian.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.26's validation criterion is "converges on case where pure Newton fails
 * (constructed near-envelope)", and the construction is the substantive half of
 * this file — a case where Newton fails is easy to produce by accident and
 * worthless, because it proves nothing about *why*.
 *
 * **The case, and why every part of it is load-bearing.** An unconstrained aim
 * problem has no fold at all: the solution set of a ground-impact shot is a
 * curve in `(θ, v₀)`, and a target past the envelope at one speed is simply
 * reached at a higher one. The degeneracy the blueprint pairs LM with — *"the
 * envelope is a fold: the two solution arcs merge and det J → 0"* — therefore
 * only exists once the launch speed is **bounded**, which is what a real machine
 * is. So the constructed case is: a quadratic-drag shot with the speed capped at
 * 60 m/s, and a point target sitting a measured 1 cm inside the 232.6 m envelope
 * that cap allows.
 *
 * There the two arcs have closed to within about a degree of each other, `∂R/∂θ`
 * at the solution is `O(√s)` in the shortfall `s`, and the minimum-norm Newton
 * step spends almost all of its length on the speed column — which the cap then
 * clips away. Newton crawls and exhausts its iterations. LM's Marquardt
 * damping reverses the allocation, puts the correction into `θ`, and converges.
 *
 * The envelope is **located here rather than hard-coded**, then checked against
 * the value this file was written against, so a change in the drag model or the
 * integrator surfaces as a failed assertion about the *scenario* rather than as
 * a mysterious change in solver behaviour.
 */

const TIGHT_TOL = {
  stepper: "dopri5" as const,
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/** The drag coefficient of a smooth sphere, the scenario library's default. */
const DRAG_COEFFICIENT = 0.47;
/** The machine's speed limit. The fold only exists because this is finite. */
const SPEED_CAP = 60;

function context() {
  return createEvalContext(
    new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(DRAG_COEFFICIENT),
    }),
  );
}

function problem(target: PointTarget): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
    ctx: context(),
    target,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/** Clamp the aim into the machine's speed box, leaving elevation free. */
const capSpeed = (aim: Aim): Aim => ({
  theta: aim.theta,
  speed: Math.min(Math.max(aim.speed, 1), SPEED_CAP),
});

/** Downrange reached at the speed cap, as a function of elevation. */
function rangeAtCap(theta: number): number {
  const residual = createShootingResidual(problem({ kind: "point", center: [0, 0] }));
  const evaluation = residual({ theta, speed: SPEED_CAP });
  return evaluation.ok ? evaluation.impact![0]! : Number.NaN;
}

/**
 * Golden-section maximisation of `R(θ)` at the speed cap.
 *
 * 40 contractions shrink a 0.9 rad bracket by `0.618⁴⁰ ≈ 3e-9`, which is four
 * orders finer than the `√s` arc separation at the closest shortfall tested and
 * costs 42 trajectory integrations. Bisection on `∂R/∂θ` would need a
 * differenced derivative at exactly the point where it is smallest; a
 * derivative-free bracket does not.
 */
function locateEnvelope(): { peak: number; maximumRange: number } {
  let lo = 0.3;
  let hi = 1.2;
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let c = hi - invPhi * (hi - lo);
  let d = lo + invPhi * (hi - lo);
  let rc = rangeAtCap(c);
  let rd = rangeAtCap(d);
  for (let i = 0; i < 40; i++) {
    if (rc < rd) {
      lo = c;
      c = d;
      rc = rd;
      d = lo + invPhi * (hi - lo);
      rd = rangeAtCap(d);
    } else {
      hi = d;
      d = c;
      rd = rc;
      c = hi - invPhi * (hi - lo);
      rc = rangeAtCap(c);
    }
  }
  const peak = (lo + hi) / 2;
  return { peak, maximumRange: rangeAtCap(peak) };
}

const ENVELOPE = locateEnvelope();

/** A target the given distance short of the envelope at the speed cap. */
function targetShortOfEnvelope(shortfall: number): PointTarget {
  return { kind: "point", center: [ENVELOPE.maximumRange - shortfall, 0] };
}

describe("the constructed near-envelope case", () => {
  it("puts the maximum-range elevation and envelope where this file was written against them", () => {
    // Drag pulls the maximum-range elevation below the drag-free π/4 ≈ 0.7854,
    // and this scenario is light enough that it only comes down to ~0.724 —
    // 41.5°. Pinned so that a change to the drag model or the stepper fails
    // here, naming the scenario, rather than downstream in a solver assertion.
    expect(ENVELOPE.peak).toBeCloseTo(0.7238770840242084, 6);
    expect(ENVELOPE.maximumRange).toBeCloseTo(232.61580676320023, 6);
    expect(ENVELOPE.peak).toBeLessThan(Math.PI / 4);
  });

  it("closes the two arcs to within about a degree at the shortfall the solver tests use", () => {
    // Near a quadratic maximum the arcs sit at θ_p ± √(2s/|R''|), so a 1 cm
    // shortfall against a 232.6 m envelope is a genuinely merged pair rather
    // than two comfortably separated roots. Measured by walking out from the
    // peak until the range drops past the target.
    const shortfall = 0.01;
    const target = ENVELOPE.maximumRange - shortfall;
    let separation = 0;
    for (let step = 1e-4; step < 0.2; step += 1e-4) {
      if (rangeAtCap(ENVELOPE.peak + step) < target) {
        separation = 2 * step;
        break;
      }
    }
    expect(separation).toBeGreaterThan(0);
    expect(separation).toBeLessThan(0.04); // < 2.3°
  });
});

describe("why the minimum-norm step is the wrong step here", () => {
  it("measures a Jacobian row that points almost entirely at the speed the cap has frozen", () => {
    // The mechanism levenberg-marquardt.ts's doc comment describes, measured
    // rather than argued. In the scaled variables the surviving Jacobian row is
    // (a, b) with a = dR/dtheta * thetaScale and b = dR/dv0 * speedScale, and
    // the minimum-norm step is parallel to it — so b/a is the ratio in which
    // Newton allocates the correction between speed and elevation.
    const residual = createShootingResidual(problem(targetShortOfEnvelope(0.01)));
    const jacobian = shootingJacobian(
      residual,
      { theta: 0.7, speed: 50 },
      {
        thetaScale: 1,
        speedScale: 50,
      },
    );
    expect(jacobian.ok).toBe(true);

    const a = jacobian.matrix![0]![0]! * 1;
    const b = jacobian.matrix![0]![1]! * 50;
    // Speed dominates by several times over at an ordinary aim, so several times
    // more of the minimum-norm step goes into the one variable the cap will not
    // let move.
    expect(Math.abs(b / a)).toBeGreaterThan(3);

    // And the vertical row is the structural zero P5.05 measured: it is what
    // makes the matrix rank 1, so there is no second direction to fall back on.
    expect(Math.abs(jacobian.matrix![1]![0]!)).toBeLessThan(1e-8);
    expect(Math.abs(jacobian.matrix![1]![1]!)).toBeLessThan(1e-8);
  });

  it("shows a flattening theta sensitivity as the target approaches the envelope", () => {
    // dR/dtheta at the peak is zero by definition, so the closer the target sits
    // to the envelope the smaller `a` becomes at the solution and the more
    // lopsided the allocation above gets. Sampled at the peak itself, where the
    // fold is.
    const residual = createShootingResidual(problem(targetShortOfEnvelope(0.01)));
    const atPeak = shootingJacobian(residual, { theta: ENVELOPE.peak, speed: SPEED_CAP }, {});
    const away = shootingJacobian(residual, { theta: 0.5, speed: SPEED_CAP }, {});
    expect(atPeak.ok).toBe(true);
    expect(away.ok).toBe(true);
    expect(Math.abs(atPeak.matrix![0]![0]!)).toBeLessThan(Math.abs(away.matrix![0]![0]!) / 100);
  });
});

describe("levenbergMarquardt on the near-envelope case pure Newton fails", () => {
  const shortfall = 0.01;
  const residual = createShootingResidual(problem(targetShortOfEnvelope(shortfall)));
  const start: Aim = { theta: 0.7, speed: 50 };
  const tolerance = 1e-6;

  it("is a case pure Newton does not solve, and does not solve it by diverging", () => {
    const newton = newtonShooting(residual, start, {
      projection: capSpeed,
      residualTolerance: tolerance,
      maxIterations: 40,
    });
    expect(newton.converged).toBe(false);
    expect(newton.status).toBe("max-iterations");
    // The distinction that makes this a *fair* test: Newton is not blowing up,
    // it is creeping. It gets three orders of magnitude closer than it started
    // and then runs out of iterations two orders short of the tolerance, which
    // is the crawl the module's doc comment describes and not a broken solve.
    expect(newton.merit).toBeLessThan(0.02);
    expect(newton.merit).toBeGreaterThan(100 * tolerance);
    expect(newton.aim.speed).toBeCloseTo(SPEED_CAP, 6); // the cap is active
  });

  it("converges where Newton did, with the same tolerance and iteration budget", () => {
    const lm = levenbergMarquardt(residual, start, {
      projection: capSpeed,
      residualTolerance: tolerance,
      maxIterations: 40,
    });
    expect(lm.converged).toBe(true);
    expect(lm.status).toBe("converged");
    expect(lm.merit).toBeLessThanOrEqual(tolerance);
    expect(lm.iterations).toBeLessThanOrEqual(40);
    // The answer is a real aim, not a converged-looking one: it is inside the
    // speed box and it actually lands on the target.
    expect(lm.aim.speed).toBeLessThanOrEqual(SPEED_CAP);
    expect(lm.residual.ok).toBe(true);
    expect(lm.residual.impact![0]!).toBeCloseTo(ENVELOPE.maximumRange - shortfall, 5);
  });

  it("gets there by damping rather than by luck", () => {
    const lm = levenbergMarquardt(residual, start, {
      projection: capSpeed,
      residualTolerance: tolerance,
      maxIterations: 40,
    });
    expect(lm.history.length).toBeGreaterThan(1);
    // Every recorded step was accepted on a positive gain ratio — the merit
    // fell monotonically — which is what distinguishes a damped descent from a
    // sequence that happened to land somewhere good.
    for (const step of lm.history) {
      expect(step.gainRatio).toBeGreaterThan(0);
      expect(step.nextMerit).toBeLessThan(step.merit);
      expect(step.lambda).toBeGreaterThan(0);
    }
  });
});

describe("levenbergMarquardt is a fallback, not a replacement", () => {
  it("costs more iterations than Newton on a target both solvers reach", () => {
    // Well inside the envelope the Gauss-Newton step is trustworthy and
    // quadratically convergent; damping it away is pure cost. This is the
    // measurement that fixes the order in shootingWithFallback.
    const residual = createShootingResidual(problem(targetShortOfEnvelope(1)));
    const start: Aim = { theta: 0.7, speed: 50 };
    const options = { projection: capSpeed, residualTolerance: 1e-6, maxIterations: 40 };

    const newton = newtonShooting(residual, start, options);
    const lm = levenbergMarquardt(residual, start, options);

    expect(newton.converged).toBe(true);
    expect(lm.converged).toBe(true);
    expect(newton.iterations).toBeLessThan(lm.iterations);
    expect(newton.evaluations).toBeLessThan(lm.evaluations);
  });
});

describe("shootingWithFallback", () => {
  const options = {
    projection: capSpeed,
    residualTolerance: 1e-6,
  };

  it("answers from Newton, and does not run LM at all, when Newton converges", () => {
    const residual = createShootingResidual(problem(targetShortOfEnvelope(1)));
    const result = shootingWithFallback(residual, { theta: 0.7, speed: 50 }, options);
    expect(result.converged).toBe(true);
    expect(result.solver).toBe("newton");
    expect(result.levenbergMarquardt).toBeUndefined();
    expect(result.evaluations).toBe(result.newton.evaluations);
  });

  it("hands over to LM when Newton does not converge, and reports which leg answered", () => {
    const residual = createShootingResidual(problem(targetShortOfEnvelope(0.01)));
    const result = shootingWithFallback(residual, { theta: 0.7, speed: 50 }, options);
    expect(result.newton.converged).toBe(false);
    expect(result.solver).toBe("levenberg-marquardt");
    expect(result.converged).toBe(true);
    expect(result.merit).toBeLessThanOrEqual(1e-6);
    expect(result.evaluations).toBeGreaterThan(result.newton.evaluations);
  });

  it("warm starts from Newton's best aim, worth orders of magnitude on a start neither finishes", () => {
    // From an aim on the far side of the peak, neither solver reaches the
    // target — this is a basin problem and belongs to P5.27's multi-start, not
    // here. What warm starting buys is measured on exactly that case: Newton's
    // crawl ends far short but much closer than it began, and LM continued from
    // there lands four to five orders of magnitude nearer than LM started cold.
    // Asserted as a comparison rather than as convergence, because claiming the
    // chain rescues this start would be false.
    const residual = createShootingResidual(problem(targetShortOfEnvelope(1)));
    const start: Aim = { theta: 1.0, speed: 58 };

    const cold = levenbergMarquardt(residual, start, options);
    const chained = shootingWithFallback(residual, start, options);

    expect(cold.converged).toBe(false);
    expect(chained.converged).toBe(false);
    expect(chained.solver).toBe("levenberg-marquardt");
    expect(chained.merit).toBeLessThan(cold.merit / 1e4);
    // And the chain never returns something worse than the leg it started from.
    expect(chained.merit).toBeLessThan(chained.newton.merit);
  });
});

describe("levenbergMarquardt argument handling", () => {
  const residual = createShootingResidual(problem(targetShortOfEnvelope(1)));

  it("rejects non-positive scales and damping rather than producing a silent NaN", () => {
    for (const bad of [
      { thetaScale: 0 },
      { thetaScale: -1 },
      { speedScale: Number.NaN },
      { initialDamping: 0 },
      { initialDamping: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => levenbergMarquardt(residual, { theta: 0.7, speed: 50 }, bad)).toThrow(
        /must be finite and positive/,
      );
    }
  });

  it("reports evaluation-failed, not a crash, when the initial aim has no trajectory", () => {
    // An integration backstop shorter than any flight, so the terminal event
    // never fires and the residual comes back `ok: false`. Constructed this way
    // rather than with a degenerate aim on purpose: a zero-speed vertical shot
    // does *not* fail — it triggers ground impact at t = 0 and reports a
    // perfectly valid impact at the launch point, which was this test's first
    // and wrong guess at an unreachable aim.
    const noImpact = createShootingResidual({
      ...problem({ kind: "point", center: [100, 0] }),
      tspan: [0, 0.001],
    });
    expect(noImpact({ theta: 0.7, speed: 50 }).ok).toBe(false);

    const result = levenbergMarquardt(noImpact, { theta: 0.7, speed: 50 });
    expect(result.converged).toBe(false);
    expect(result.status).toBe("evaluation-failed");
    expect(result.failure).toMatch(/nothing to iterate from/);
  });

  it("reports converged without iterating when the initial aim is already on target", () => {
    const seed = createShootingResidual(problem({ kind: "point", center: [0, 0] }));
    const landing = seed({ theta: 0.6, speed: 55 });
    expect(landing.ok).toBe(true);
    const onTarget = createShootingResidual(
      problem({ kind: "point", center: [landing.impact![0]!, 0] }),
    );
    const result = levenbergMarquardt(onTarget, { theta: 0.6, speed: 55 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
    expect(result.history).toHaveLength(0);
  });
});
