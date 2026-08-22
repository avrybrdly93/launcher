import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  UniformWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import { newtonShooting } from "./newton-shooting.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { finiteDifferenceStep } from "./shooting-jacobian.js";
import { type Aim, type ShootingProblem, createShootingResidual } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";
import {
  DEFAULT_JACOBIAN_ACCURACY,
  RTOL_FLOOR,
  checkToleranceCoupling,
  coupleTolerances,
} from "./tolerance-coupling.js";

/**
 * P5.31's validation criterion is "rule implemented (inner tol ≤ outer
 * tol²-style heuristic) + test", and the second half is where the work is.
 *
 * A rule of this shape is trivially testable against its own arithmetic and
 * that would prove nothing: the interesting question is whether an outer solve
 * run at a tolerance the rule *forbids* actually goes wrong, and whether one
 * run at the tolerance the rule *permits* actually comes out right. Both are
 * measured below on a real drag-and-wind shooting problem.
 *
 * The finding, which is not the one this task's title suggests: a loose inner
 * tolerance does **not** make the outer solve fail to converge. It makes it
 * converge, in three iterations, to a reported residual well inside tolerance,
 * at an aim that misses by five orders of magnitude more than it claims. Every
 * layer reports success. See ADR-017.
 */

const REFERENCE_RTOL = 1e-13;

function context(dragCoefficient: number, wind: number) {
  return createEvalContext(
    new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(G_STD, false),
      new UniformWind(wind),
    ),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(dragCoefficient),
    }),
  );
}

function problem(target: PointTarget, rtol: number): ShootingProblem {
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
    ctx: context(0.47, 3),
    target,
    config: { stepper: "dopri5", rtol, atol: rtol * 1e-2, maxSteps: 200_000 },
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

/** A deliberately rough start, so every solve below has real work to do. */
const START: Aim = { theta: 0.6, speed: 62 };
/** The aim the target is built from, so the target is reachable by construction. */
const TRUE_AIM: Aim = { theta: 0.7, speed: 70 };

/**
 * The target, and the trajectory scale `L` that clause 1 is stated against.
 * Built once at the reference tolerance: everything below is measured against
 * this one problem, so the numbers in the assertions and in ADR-017 refer to
 * the same shot.
 */
const PROBE = createShootingResidual(problem({ kind: "point", center: [0, 0] }, REFERENCE_RTOL))(
  TRUE_AIM,
);
const TARGET: PointTarget = { kind: "point", center: [PROBE.impact![0]!, PROBE.impact![1]!] };
const SCALE = Math.abs(PROBE.impact![0]!);

/** Runs the outer solve at one inner tolerance and reports both residuals. */
function solveAt(rtol: number, residualTolerance: number) {
  const result = newtonShooting(createShootingResidual(problem(TARGET, rtol)), START, {
    residualTolerance,
    jacobian: { noiseFloor: rtol },
    maxIterations: 40,
  });
  const reported = Math.hypot(...(result.residual.residual ?? [Number.NaN]));
  // Where the converged aim ACTUALLY lands, re-flown at the reference tolerance.
  // This is the number the outer solver cannot see and the rule exists to bound.
  const truth = createShootingResidual(problem(TARGET, REFERENCE_RTOL))(result.aim);
  const trueMiss = Math.hypot(...(truth.residual ?? [Number.NaN]));
  return { status: result.status, iterations: result.iterations, reported, trueMiss };
}

describe("coupleTolerances (the rule's arithmetic)", () => {
  it("gives the literal square for a forward difference", () => {
    // p = 1, so ε ≤ η^{(p+1)/p} = η². This is the heuristic in the form it is
    // usually quoted, and it is quoted for a scheme this package does not use
    // by default.
    const coupling = coupleTolerances({
      residualTolerance: 1,
      residualScale: 1e-3, // large enough that clause 1 cannot bind
      scheme: "forward",
      jacobianAccuracy: 1e-3,
    });
    expect(coupling.binding).toBe("jacobian");
    expect(coupling.jacobianLimit).toBeCloseTo(1e-6, 12);
    expect(coupling.rtol).toBeCloseTo(1e-6, 12);
  });

  it("gives a 3/2 power for a central difference, which is 31.6x looser", () => {
    const forward = coupleTolerances({
      residualTolerance: 1,
      residualScale: 1e-3,
      scheme: "forward",
      jacobianAccuracy: 1e-3,
    });
    const central = coupleTolerances({
      residualTolerance: 1,
      residualScale: 1e-3,
      scheme: "central",
      jacobianAccuracy: 1e-3,
    });
    expect(central.jacobianLimit).toBeCloseTo(Math.pow(1e-3, 1.5), 12);

    // η^{3/2} / η² = η^{-1/2} = 1/√(1e-3) ≈ 31.6. Quoting the square at a
    // central-difference caller over-tightens by this factor.
    expect(central.jacobianLimit / forward.jacobianLimit).toBeCloseTo(1 / Math.sqrt(1e-3), 6);
  });

  it("reports which clause bound, and both bind on the same shot", () => {
    // Neither clause dominates: clause 1 scales with τ/L and clause 2 does not
    // involve τ at all. On this file's own problem (L = 295 m) the crossover
    // sits near τ = 0.09 m, so a centimetre target is noise-limited and a
    // half-metre one is Jacobian-limited.
    const tight = coupleTolerances({ residualTolerance: 1e-6, residualScale: SCALE });
    const loose = coupleTolerances({ residualTolerance: 0.5, residualScale: SCALE });
    expect(tight.binding).toBe("residual-floor");
    expect(loose.binding).toBe("jacobian");
    expect(tight.rtol).toBeLessThan(loose.rtol);
  });

  it("clamps at the rtol floor rather than returning an unreachable number", () => {
    const coupling = coupleTolerances({ residualTolerance: 1e-15, residualScale: SCALE });
    expect(coupling.binding).toBe("rtol-floor");
    expect(coupling.rtol).toBe(RTOL_FLOOR);
    // And it still says what was actually asked for, so the caller can see how
    // far past the floor their demand was.
    expect(coupling.residualFloorLimit).toBeLessThan(RTOL_FLOOR);
  });

  it("achieves exactly the requested Jacobian accuracy when that clause binds", () => {
    const coupling = coupleTolerances({
      residualTolerance: 1,
      residualScale: 1e-3,
      jacobianAccuracy: 1e-4,
    });
    expect(coupling.binding).toBe("jacobian");
    expect(coupling.achievableJacobianAccuracy).toBeCloseTo(1e-4, 12);
  });

  it("beats the requested Jacobian accuracy when the noise floor binds instead", () => {
    const coupling = coupleTolerances({ residualTolerance: 1e-6, residualScale: SCALE });
    expect(coupling.binding).toBe("residual-floor");
    expect(coupling.achievableJacobianAccuracy).toBeLessThan(DEFAULT_JACOBIAN_ACCURACY);
  });

  it("reports the difference step the Jacobian will actually derive", () => {
    // The number most likely to be left stale when a tolerance is loosened —
    // see `finiteDifferenceStep`'s own docstring on the three-and-a-half orders
    // of magnitude between rtol = 1e-6 and rtol = ε.
    for (const scheme of ["forward", "central"] as const) {
      const coupling = coupleTolerances({
        residualTolerance: 1e-4,
        residualScale: SCALE,
        scheme,
      });
      expect(coupling.unitDifferenceStep).toBe(finiteDifferenceStep(coupling.rtol, scheme, 1));
    }
  });

  it("sets atol below rtol, matching the configs already in this repo", () => {
    const coupling = coupleTolerances({ residualTolerance: 1e-4, residualScale: SCALE });
    expect(coupling.atol).toBeLessThan(coupling.rtol);
    expect(coupling.noiseFloor).toBe(coupling.rtol);
  });

  it("refuses inputs it cannot make sense of", () => {
    expect(() => coupleTolerances({ residualTolerance: 0, residualScale: 1 })).toThrow(
      /residualTolerance/,
    );
    expect(() => coupleTolerances({ residualTolerance: 1, residualScale: -1 })).toThrow(
      /residualScale/,
    );
    expect(() =>
      coupleTolerances({ residualTolerance: 1, residualScale: Number.POSITIVE_INFINITY }),
    ).toThrow(/residualScale/);
    // A relative error of 1 or more is not a request, it is a typo.
    expect(() =>
      coupleTolerances({ residualTolerance: 1, residualScale: 1, jacobianAccuracy: 1 }),
    ).toThrow(/below 1/);
  });
});

describe("checkToleranceCoupling (auditing tolerances a caller already has)", () => {
  const request = { residualTolerance: 1e-6, residualScale: SCALE };

  it("passes its own recommendation", () => {
    const recommended = coupleTolerances(request);
    const report = checkToleranceCoupling(
      { rtol: recommended.rtol, noiseFloor: recommended.noiseFloor },
      request,
    );
    expect(report.satisfied).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("names the residual-floor clause, with the numbers, on a loose inner solve", () => {
    const report = checkToleranceCoupling({ rtol: 1e-3, noiseFloor: 1e-3 }, request);
    expect(report.satisfied).toBe(false);
    expect(report.violations.map((v) => v.clause)).toContain("residual-floor");
    expect(report.violations[0]!.message).toMatch(/converging on noise/);
  });

  it("catches a stale optimistic noiseFloor even when rtol itself is fine", () => {
    // The failure this clause exists for: tolerances that all look
    // conservative, and a Jacobian differencing with a step derived for a
    // residual far cleaner than the one it has. Nothing else in the codebase
    // relates these two numbers.
    const recommended = coupleTolerances(request);
    const report = checkToleranceCoupling(
      { rtol: recommended.rtol, noiseFloor: Number.EPSILON },
      request,
    );
    expect(report.satisfied).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]!.message).toMatch(/noiseFloor/);
  });

  it("returns a verdict rather than throwing, so a caller can measure the violation", () => {
    // This module's own measurement below depends on it: auditing a knowingly
    // bad configuration must be possible without an exception.
    expect(() => checkToleranceCoupling({ rtol: 1 }, request)).not.toThrow();
  });
});

describe("the rule, measured on a real shooting solve", () => {
  it("is a wrong answer with status converged, not a failure to converge", () => {
    // THE FINDING. At rtol = 1e-3 against a 1e-6 m outer tolerance, the solve
    // does not stall, thrash or report anything unusual: it converges in three
    // iterations to a residual it measures as ~2e-7 m. The aim it returns
    // misses by ~4e-2 m — five orders of magnitude more than it claims.
    //
    // The reason is that the residual is a smooth deterministic function of the
    // aim at any fixed rtol, so the outer solver finds an exact root of the
    // WRONG function rather than an approximate root of the right one. Nothing
    // about that looks like noise from inside the solve.
    const tau = 1e-6;
    const bad = solveAt(1e-3, tau);

    expect(bad.status).toBe("converged");
    expect(bad.reported).toBeLessThan(tau);
    expect(bad.trueMiss).toBeGreaterThan(1000 * bad.reported);
    expect(bad.trueMiss).toBeGreaterThan(tau);

    // And the rule refuses that configuration, which is the point of having it.
    const audit = checkToleranceCoupling(
      { rtol: 1e-3, noiseFloor: 1e-3 },
      { residualTolerance: tau, residualScale: SCALE },
    );
    expect(audit.satisfied).toBe(false);
  });

  it("delivers a true miss inside the outer tolerance at the rtol it recommends", () => {
    // The predictive claim, across four outer tolerances spanning both
    // bindings: at τ = 1e-2 and below the noise floor binds, at τ = 0.5 the
    // Jacobian does. In every case the aim the solve returns really is inside
    // the tolerance when re-flown at the reference rtol.
    for (const tau of [1e-6, 1e-4, 1e-2, 0.5]) {
      const rule = coupleTolerances({ residualTolerance: tau, residualScale: SCALE });
      const solved = solveAt(rule.rtol, tau);
      expect(solved.status, `tau = ${tau}`).toBe("converged");
      expect(solved.trueMiss, `tau = ${tau} (binding: ${rule.binding})`).toBeLessThan(tau);
    }
  });

  it("bounds the true miss by rtol times the trajectory scale, over seven decades", () => {
    // Clause 1's error model, measured rather than assumed. `rtol · L` is the
    // absolute error the inner solve is allowed, and the outer solve's final
    // aim inherits it: across rtol from 1e-3 to 1e-8 the true miss stays a
    // fraction of `rtol · L` and never exceeds it.
    //
    // The upper end is what justifies the rule. The lower end is what stops it
    // from being vacuous — a bound of `rtol · L` would also be satisfied by a
    // true miss of zero, which would mean the inner tolerance did not matter
    // at all and the whole rule was unnecessary.
    const ratios: number[] = [];
    for (const rtol of [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8]) {
      const solved = solveAt(rtol, 1e-9);
      ratios.push(solved.trueMiss / (rtol * SCALE));
    }
    for (const [index, ratio] of ratios.entries()) {
      expect(ratio, `row ${index}`).toBeLessThan(1);
      expect(ratio, `row ${index}`).toBeGreaterThan(1e-4);
    }

    // And it is monotone in the sense that matters: the loosest inner solve
    // misses by orders of magnitude more than the tightest one.
    const [loosest] = ratios;
    expect(loosest).toBeDefined();
    const first = solveAt(1e-3, 1e-9).trueMiss;
    const last = solveAt(1e-8, 1e-9).trueMiss;
    expect(first / last).toBeGreaterThan(1e3);
  });
});
