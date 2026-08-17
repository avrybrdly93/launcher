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
import {
  DEFAULT_PENALTY_WEIGHT,
  aimActiveSet,
  boundsPenaltyRows,
  constrainedShooting,
  projectAim,
  validateAimBounds,
  withBoundsPenalty,
} from "./constraints.js";
import { PLANAR_LAYOUT } from "./observables.js";
import { newtonShooting } from "./newton-shooting.js";
import {
  type Aim,
  type ShootingProblem,
  type ShootingResidual,
  createShootingResidual,
} from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.16's validation criterion is "constrained solutions respect bounds;
 * active-set reported", and the two halves are checked here in the way that can
 * actually fail: **feasibility is recomputed from the returned aim and the
 * bounds**, never read off a flag the solver set about itself. A solver that
 * reported `feasible: true` while returning an out-of-box aim would pass a test
 * written the other way round.
 *
 * The integration exhibits all use one problem — a 1 kg, 5 cm sphere at
 * `Cd = 0.47` shooting at a point 400 m downrange — because the interesting
 * behaviour is entirely in where the bound sits relative to the unconstrained
 * answer, not in the dynamics. Unconstrained, that target is hit at
 * `θ = 0.6475 rad, v₀ = 95.47 m/s` in 3 iterations; every capped solve below is
 * measured against those two numbers.
 */

const TIGHT_TOL = { stepper: "dopri5" as const, rtol: 1e-12, atol: 1e-14, maxSteps: 200_000 };

const TARGET: PointTarget = { kind: "point", center: [400, 0] };

/** The aim the unconstrained solve converges to, measured. Every cap below is relative to it. */
const UNCONSTRAINED_AIM = { theta: 0.6475001843208092, speed: 95.47008082976205 } as const;

/** A rough starting aim, deliberately not the answer. */
const START: Aim = { theta: 0.6, speed: 80 };

function problem(drag: number): ShootingProblem {
  const forces = drag === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(drag),
      }),
    ),
    target: TARGET,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 60],
    layout: PLANAR_LAYOUT,
  };
}

function dragResidual() {
  return createShootingResidual(problem(0.47));
}

describe("validateAimBounds", () => {
  it("accepts an empty box, a half-open box, and a degenerate one", () => {
    expect(() => validateAimBounds({})).not.toThrow();
    expect(() => validateAimBounds({ speedMax: 90 })).not.toThrow();
    expect(() => validateAimBounds({ speedMin: 70, speedMax: 70 })).not.toThrow();
  });

  it("rejects an inverted box on either variable", () => {
    expect(() => validateAimBounds({ speedMin: 90, speedMax: 70 })).toThrow(/no aim is feasible/);
    expect(() => validateAimBounds({ thetaMin: 1, thetaMax: 0 })).toThrow(/no aim is feasible/);
  });

  it("rejects NaN, which would otherwise make every comparison silently false", () => {
    expect(() => validateAimBounds({ speedMax: Number.NaN })).toThrow(/must not be NaN/);
  });
});

describe("projectAim", () => {
  it("clamps each coordinate independently", () => {
    const bounds = { thetaMin: 0.1, thetaMax: 1.2, speedMin: 10, speedMax: 90 };
    expect(projectAim({ theta: 0.5, speed: 50 }, bounds)).toEqual({ theta: 0.5, speed: 50 });
    expect(projectAim({ theta: 2, speed: 200 }, bounds)).toEqual({ theta: 1.2, speed: 90 });
    expect(projectAim({ theta: -1, speed: 0 }, bounds)).toEqual({ theta: 0.1, speed: 10 });
    // One coordinate out, the other untouched — the separability that makes a
    // per-coordinate clamp the Euclidean projection at all.
    expect(projectAim({ theta: 0.5, speed: 200 }, bounds)).toEqual({ theta: 0.5, speed: 90 });
  });

  it("is idempotent", () => {
    const bounds = { thetaMax: 1, speedMax: 90 };
    const once = projectAim({ theta: 3, speed: 300 }, bounds);
    expect(projectAim(once, bounds)).toEqual(once);
  });

  it("is non-expansive, which is what makes the projected-arc line search terminate", () => {
    const bounds = { thetaMin: 0.2, thetaMax: 1.0, speedMin: 20, speedMax: 90 };
    const pairs: readonly (readonly [Aim, Aim])[] = [
      [
        { theta: 0.5, speed: 50 },
        { theta: 3, speed: 300 },
      ],
      [
        { theta: -2, speed: 5 },
        { theta: 2, speed: 250 },
      ],
      [
        { theta: 0.9, speed: 88 },
        { theta: 1.4, speed: 140 },
      ],
    ];
    for (const [a, b] of pairs) {
      const before = Math.hypot(a.theta - b.theta, a.speed - b.speed);
      const pa = projectAim(a, bounds);
      const pb = projectAim(b, bounds);
      const after = Math.hypot(pa.theta - pb.theta, pa.speed - pb.speed);
      expect(after).toBeLessThanOrEqual(before + 1e-15);
    }
  });
});

describe("aimActiveSet", () => {
  it("reports a free aim as free, with negative slack and no active bounds", () => {
    const set = aimActiveSet({ theta: 0.5, speed: 50 }, { thetaMax: 1, speedMax: 90 });
    expect(set.theta).toBe("free");
    expect(set.speed).toBe("free");
    expect(set.activeCount).toBe(0);
    expect(set.feasible).toBe(true);
    expect(set.thetaSlack).toBeLessThan(0);
    expect(set.speedSlack).toBeLessThan(0);
  });

  it("names which face is active, per variable", () => {
    const bounds = { thetaMin: 0.1, thetaMax: 1.2, speedMin: 10, speedMax: 90 };
    expect(aimActiveSet({ theta: 1.2, speed: 50 }, bounds).theta).toBe("upper");
    expect(aimActiveSet({ theta: 0.1, speed: 50 }, bounds).theta).toBe("lower");
    expect(aimActiveSet({ theta: 0.5, speed: 90 }, bounds).speed).toBe("upper");
    expect(aimActiveSet({ theta: 0.5, speed: 10 }, bounds).speed).toBe("lower");
    expect(aimActiveSet({ theta: 1.2, speed: 90 }, bounds).activeCount).toBe(2);
  });

  it("counts a variable pinned by a degenerate box once, not twice", () => {
    const set = aimActiveSet({ theta: 0.5, speed: 70 }, { speedMin: 70, speedMax: 70 });
    expect(set.speed).not.toBe("free");
    expect(set.activeCount).toBe(1);
    expect(set.feasible).toBe(true);
  });

  it("reports an out-of-box aim as infeasible with positive slack", () => {
    const set = aimActiveSet({ theta: 0.5, speed: 120 }, { speedMax: 90 });
    expect(set.feasible).toBe(false);
    expect(set.speedSlack).toBeCloseTo(30, 12);
  });

  it("treats an unbounded variable as infinitely slack rather than as active", () => {
    const set = aimActiveSet({ theta: 0.5, speed: 50 }, {});
    expect(set.thetaSlack).toBe(Number.NEGATIVE_INFINITY);
    expect(set.speedSlack).toBe(Number.NEGATIVE_INFINITY);
    expect(set.activeCount).toBe(0);
    expect(set.feasible).toBe(true);
  });

  it("honours the tolerance it is given", () => {
    const bounds = { speedMax: 90 };
    expect(aimActiveSet({ theta: 0.5, speed: 89.999 }, bounds).speed).toBe("free");
    expect(aimActiveSet({ theta: 0.5, speed: 89.999 }, bounds, { tolerance: 1e-2 }).speed).toBe(
      "upper",
    );
  });
});

describe("boundsPenaltyRows", () => {
  it("is exactly zero inside the box, on every face", () => {
    const bounds = { thetaMin: 0.1, thetaMax: 1.2, speedMin: 10, speedMax: 90 };
    expect(boundsPenaltyRows({ theta: 0.5, speed: 50 }, bounds)).toEqual([0, 0, 0, 0]);
    // On the face is still zero: the hinge is closed on the feasible side, which
    // is what keeps a converged on-bound solve from carrying a penalty.
    expect(boundsPenaltyRows({ theta: 1.2, speed: 90 }, bounds)).toEqual([0, 0, 0, 0]);
  });

  it("scales the violation by √w, in the documented row order", () => {
    const rows = boundsPenaltyRows(
      { theta: 2, speed: 5 },
      { thetaMin: 0.1, thetaMax: 1.2, speedMin: 10, speedMax: 90 },
      { thetaWeight: 4, speedWeight: 9 },
    );
    // θ = 2 is 0.8 above thetaMax; v₀ = 5 is 5 below speedMin.
    expect(rows).toHaveLength(4);
    expect(rows[0]!).toBe(0); // θ lower: not violated
    expect(rows[1]!).toBeCloseTo(2 * 0.8, 12); // θ upper: √4 × 0.8
    expect(rows[2]!).toBeCloseTo(3 * 5, 12); // v₀ lower: √9 × 5
    expect(rows[3]!).toBe(0); // v₀ upper: not violated
  });

  it("keeps a fixed length of four when a bound is absent", () => {
    // The row count must not depend on the aim or on which bounds exist: the
    // residual it is appended to gets finite-differenced, and a vector whose
    // length changes with the aim is not a differentiable function at all.
    expect(boundsPenaltyRows({ theta: 9, speed: 9 }, {})).toEqual([0, 0, 0, 0]);
    expect(boundsPenaltyRows({ theta: 9, speed: 9 }, { speedMax: 1 })).toHaveLength(4);
  });

  it("rejects a negative or non-finite weight", () => {
    expect(() => boundsPenaltyRows({ theta: 0, speed: 0 }, {}, { thetaWeight: -1 })).toThrow(
      /non-negative/,
    );
    expect(() =>
      boundsPenaltyRows({ theta: 0, speed: 0 }, {}, { speedWeight: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite/);
  });
});

describe("withBoundsPenalty", () => {
  it("appends four rows to a successful residual and leaves the miss components alone", () => {
    const residual = dragResidual();
    const bare = residual(START);
    const penalized = withBoundsPenalty(residual, { speedMax: 70 })(START);
    expect(bare.residual).not.toBeNull();
    expect(penalized.residual).toHaveLength(bare.residual!.length + 4);
    expect(penalized.residual!.slice(0, bare.residual!.length)).toEqual(bare.residual);
    // START is 10 m/s over the cap, so the v₀-upper row is √w × 10.
    expect(penalized.residual!.at(-1)!).toBeCloseTo(Math.sqrt(DEFAULT_PENALTY_WEIGHT) * 10, 6);
  });

  it("passes a failed evaluation through untouched rather than inventing a merit for it", () => {
    // A stub rather than a real aim that fails to impact: the behaviour under
    // test is the `ok: false` branch, and pinning it to whichever physical aim
    // happens to exhaust `tspan` today would make this a test of the dynamics.
    const failing: ShootingResidual = {
      residual: null,
      impact: null,
      timeOfFlight: null,
      ok: false,
      report: {
        status: "failed",
        tFinal: 0,
        yFinal: new Float64Array(4),
        nSteps: 0,
        nRHS: 0,
        nRejected: 0,
      },
      aim: START,
    };
    const penalized = withBoundsPenalty(() => failing, { speedMin: 50 })(START);
    expect(penalized).toBe(failing);
    expect(penalized.residual).toBeNull();
    expect(penalized.ok).toBe(false);
  });
});

describe("constrainedShooting — projection strategy", () => {
  it("reproduces the unconstrained answer when no bound binds", () => {
    const result = constrainedShooting(dragResidual(), START, { speedMax: 200 });
    expect(result.status).toBe("converged-interior");
    expect(result.activeSet.activeCount).toBe(0);
    expect(result.feasible).toBe(true);
    expect(result.aim.theta).toBeCloseTo(UNCONSTRAINED_AIM.theta, 9);
    expect(result.aim.speed).toBeCloseTo(UNCONSTRAINED_AIM.speed, 9);
    expect(result.miss).toBeLessThan(1e-6);
  });

  it("respects a binding speed cap exactly, and says which bound is carrying the miss", () => {
    const cap = 70;
    const result = constrainedShooting(dragResidual(), START, { speedMax: cap });

    // Feasibility recomputed from the returned aim, not read off the result.
    expect(aimActiveSet(result.aim, { speedMax: cap }).feasible).toBe(true);
    expect(result.aim.speed).toBeLessThanOrEqual(cap);
    expect(result.aim.speed).toBeCloseTo(cap, 12);

    expect(result.activeSet.speed).toBe("upper");
    expect(result.activeSet.theta).toBe("free");
    expect(result.status).toBe("blocked-by-bound");

    // The target is genuinely out of reach at 70 m/s, and the residual left over
    // is the proof — 116.76 m of miss, measured, not asserted.
    expect(result.miss).toBeGreaterThan(100);
    expect(result.miss).toBeCloseTo(116.7596, 3);
  });

  it("tightening the cap monotonically increases the miss it cannot remove", () => {
    // 116.76 / 92.33 / 68.59 m at 70 / 75 / 80 m/s, measured.
    const misses = [70, 75, 80].map((cap) => {
      const result = constrainedShooting(dragResidual(), START, { speedMax: cap });
      expect(result.status).toBe("blocked-by-bound");
      expect(result.aim.speed).toBeCloseTo(cap, 12);
      return result.miss;
    });
    expect(misses[0]!).toBeGreaterThan(misses[1]!);
    expect(misses[1]!).toBeGreaterThan(misses[2]!);
    expect(misses[0]!).toBeCloseTo(116.7596, 3);
    expect(misses[2]!).toBeCloseTo(68.59, 3);
  });

  it("stops at a corner where the step leaves the box in both coordinates", () => {
    // Both caps sit below the unconstrained answer, so at the corner the Newton
    // direction points out of the box in θ and v₀ at once, the projected
    // displacement is zero for every α, and the solver is entitled to stop.
    // Without the projected-arc stall test this is 25 wasted backtracks and a
    // `line-search-failed` report at a constrained stationary point.
    for (const start of [
      { theta: 0.6, speed: 70 },
      { theta: 0.55, speed: 65 },
    ]) {
      const result = constrainedShooting(dragResidual(), start, { thetaMax: 0.6, speedMax: 70 });
      expect(result.newton.status).toBe("stalled");
      expect(result.status).toBe("blocked-by-bound");
      expect(result.aim).toEqual({ theta: 0.6, speed: 70 });
      expect(result.activeSet.activeCount).toBe(2);
      expect(result.feasible).toBe(true);
      // It stops promptly rather than exhausting a backtrack budget.
      expect(result.newton.iterations).toBeLessThanOrEqual(2);
    }
  });

  it("projects an infeasible starting aim before the first evaluation", () => {
    // START is at 80 m/s, outside a 70 m/s cap. Iterate zero must already be in.
    const seen: number[] = [];
    const base = dragResidual();
    const watched = (aim: Aim) => {
      seen.push(aim.speed);
      return base(aim);
    };
    constrainedShooting(watched, START, { speedMax: 70 });
    expect(seen[0]).toBe(70);
  });

  it("keeps every evaluation feasible, not merely every iterate", () => {
    // **This test used to assert the opposite, and the change is deliberate.**
    // It was written to characterize the measured gap between "every iterate is
    // feasible" (true) and "nothing is ever evaluated outside the box" (false at
    // the time): 5 of 56 evaluations landed 4.8444e-4 m/s past the cap, one
    // difference step in the speed column, filed as P0.92. P0.92 closed that gap
    // by handing the Jacobian a feasible-region hook, so the old expectation now
    // encodes a defect rather than a fact. The historical numbers are preserved
    // by the control below, which reproduces all five excursions on demand, and
    // the stencil mechanics live in shooting-jacobian-feasible.test.ts.
    const cap = 70;
    const base = dragResidual();
    const excursions: number[] = [];
    let total = 0;
    const watched = (aim: Aim) => {
      total++;
      if (aim.speed > cap) excursions.push(aim.speed - cap);
      return base(aim);
    };
    const result = constrainedShooting(watched, START, { speedMax: cap });

    expect(result.feasible).toBe(true);
    // Unchanged at 56: a one-sided column spends the same two evaluations a
    // central one does, so the fix costs nothing here.
    expect(total).toBe(56);
    expect(excursions).toEqual([]);
  });

  it("reproduces the pre-P0.92 excursions exactly when the hook is disabled", () => {
    // The control for the assertion above, and the reason it is not vacuous:
    // without it, "no excursions" could mean the stencil never reached the face
    // on this problem rather than that the fix works. `feasible: () => true` is
    // the old behaviour spelled out — every point is admissible, so no column
    // ever falls back.
    const cap = 70;
    const base = dragResidual();
    const excursions: number[] = [];
    let total = 0;
    const watched = (aim: Aim) => {
      total++;
      if (aim.speed > cap) excursions.push(aim.speed - cap);
      return base(aim);
    };

    constrainedShooting(watched, START, { speedMax: cap }, { jacobian: { feasible: () => true } });

    expect(total).toBe(56);
    expect(excursions).toHaveLength(5);
    for (const excursion of excursions) {
      expect(excursion).toBeCloseTo(4.8444e-4, 7);
    }
  });
});

describe("constrainedShooting — penalty strategy", () => {
  const cap = 70;
  const penalized = (weight: number) =>
    constrainedShooting(
      dragResidual(),
      START,
      { speedMax: cap },
      { strategy: "penalty", penalty: { speedWeight: weight, thetaWeight: weight } },
    );

  it("is feasible at the default weight, and reports the miss without the penalty rows", () => {
    const result = constrainedShooting(
      dragResidual(),
      START,
      { speedMax: cap },
      { strategy: "penalty" },
    );
    expect(result.strategy).toBe("penalty");
    expect(aimActiveSet(result.aim, { speedMax: cap }).feasible).toBe(true);
    expect(result.status).toBe("blocked-by-bound");
    // The physical miss, with the four penalty rows excluded.
    expect(result.miss).toBeCloseTo(116.7509, 3);
    // And on the plateau the answer carries *no* penalty at all: it lands just
    // inside the face, where the hinge is exactly zero, so the penalized merit
    // and the physical miss coincide. The `miss` field earns its keep at weights
    // where that is false — see the next test.
    expect(result.miss).toBe(result.newton.merit);
  });

  it("reports a miss smaller than the penalized merit when the answer is infeasible", () => {
    const result = penalized(1e1);
    expect(result.feasible).toBe(false);
    // Here the penalty rows are large and live, so quoting `newton.merit` as
    // "the miss" would overstate it by the constraint violation the strategy
    // failed to remove — 9.34 m/s of it, at √w = 3.16 metres per m/s.
    expect(result.miss).toBeLessThan(result.newton.merit);
    expect(result.miss).toBeCloseTo(71.6979, 3);
  });

  it("is grossly infeasible at too small a weight", () => {
    // The penalty is cheaper than the miss it would remove, so the solve simply
    // buys the violation: 9.35 and 9.34 m/s past a 70 m/s cap.
    for (const weight of [1, 1e1]) {
      const result = penalized(weight);
      expect(result.feasible).toBe(false);
      expect(result.activeSet.speedSlack).toBeGreaterThan(9);
    }
  });

  it("is feasible across a four-order plateau in the middle", () => {
    for (const weight of [1e3, 1e4, 1e5, 1e6, 1e7]) {
      const result = penalized(weight);
      expect(aimActiveSet(result.aim, { speedMax: cap }).feasible).toBe(true);
      // Just inside the bound rather than just outside it — the hinge is exactly
      // zero inside the box, so the iteration chatters onto the face and stops
      // there instead of settling at the smooth balance a `1/√w` argument
      // predicts.
      expect(result.activeSet.speedSlack).toBeLessThanOrEqual(0);
      expect(Math.abs(result.activeSet.speedSlack)).toBeLessThan(1e-9);
    }
  });

  it("gets worse again above the plateau, which 1/√w cannot express", () => {
    // More weight is not more feasibility: the √w rows degrade the Jacobian's
    // conditioning and the answer drifts back outside. This is the measurement
    // that refuted the module comment's first draft.
    for (const weight of [3e7, 1e8, 1e9]) {
      const result = penalized(weight);
      expect(result.feasible).toBe(false);
      expect(result.activeSet.speedSlack).toBeGreaterThan(0);
      expect(result.activeSet.speedSlack).toBeLessThan(1e-4);
    }
  });

  it("is beaten by projection at the same problem, which is the point of preferring it", () => {
    const byPenalty = penalized(1e9);
    const byProjection = constrainedShooting(dragResidual(), START, { speedMax: cap });
    expect(byPenalty.feasible).toBe(false);
    expect(byProjection.feasible).toBe(true);
    // Projection needs no weight at all, so it cannot be tuned into the failure
    // the penalty falls into one order above its window.
    expect(byProjection.aim.speed).toBeCloseTo(cap, 12);
  });
});

describe("constrainedShooting — reporting", () => {
  it("echoes the Newton result and the strategy verbatim", () => {
    const result = constrainedShooting(dragResidual(), START, { speedMax: 200 });
    expect(result.strategy).toBe("projection");
    expect(result.newton.converged).toBe(true);
    expect(result.aim).toEqual(result.newton.aim);
  });

  it("rejects an infeasible box before doing any work", () => {
    expect(() =>
      constrainedShooting(dragResidual(), START, { speedMin: 90, speedMax: 70 }),
    ).toThrow(/no aim is feasible/);
  });

  it("leaves an unconstrained solve untouched when no projection is supplied", () => {
    // The regression guard for the newton-shooting change: with no `projection`
    // option the solver must behave exactly as P5.06 left it.
    const bare = newtonShooting(dragResidual(), START);
    expect(bare.status).toBe("converged");
    expect(bare.iterations).toBe(3);
    expect(bare.aim.theta).toBeCloseTo(UNCONSTRAINED_AIM.theta, 12);
    expect(bare.aim.speed).toBeCloseTo(UNCONSTRAINED_AIM.speed, 12);
  });
});
