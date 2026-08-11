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
import { PLANAR_LAYOUT } from "./observables.js";
import { type WindScenario, robustAim, robustAimIsFeasible } from "./robust-aim.js";
import type { ShootingProblem } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.17's validation criterion is "robust aim differs from nominal in
 * headwind-vs-gust scenario (measured)", and the measurement is the point of
 * this file: `THE VALIDATION CRITERION` below records both aims and the gap.
 *
 * The rest of the file exists because a *difference* is the cheapest thing in
 * the world to produce — any bug that perturbs the aim produces one. So the
 * difference is pinned from several independent directions:
 *
 * - it vanishes exactly when the uncertainty vanishes (single-scenario ensemble),
 * - it grows monotonically with the gust's severity, and again with the gust's
 *   probability, which a perturbation-shaped bug has no reason to do,
 * - it is accompanied by a strict reduction in the risk it is supposed to buy,
 * - and at a mild gust it is visibly a *trade*: the robust shot overshoots under
 *   the nominal wind in order to fall less short under the gust.
 *
 * `THE UNBOUNDEDNESS` is a test rather than a footnote. The two-variable problem
 * genuinely has no minimum — flatter and faster is always more robust because it
 * shortens the time the wind has to act — and a test that pins that behaviour is
 * what stops a later reader "fixing" the missing convergence.
 */

const TIGHT_TOL = {
  stepper: "dopri5" as const,
  rtol: 1e-11,
  atol: 1e-13,
  maxSteps: 200_000,
};

/** The exhibit: 1 kg 5 cm sphere, Cd 0.47, in a steady horizontal wind. */
function context(wind: number) {
  return createEvalContext(
    new Environment(
      new ConstantAtmosphere(),
      new UniformGravity(G_STD, false),
      new UniformWind(wind),
    ),
    createSphericalProjectileParams({
      mass: 1,
      radius: 0.05,
      dragCoefficient: new ConstantCd(0.47),
    }),
  );
}

function problem(downrange: number, overrides: Partial<ShootingProblem> = {}): ShootingProblem {
  const target: PointTarget = { kind: "point", center: [downrange, 0] };
  return {
    model: createPlanarProjectileModel([new GravityForce(), new QuadraticDragForce()]),
    ctx: context(-6),
    target,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    layout: PLANAR_LAYOUT,
    ...overrides,
  };
}

/** Nominal −6 m/s headwind against a gust, equally likely. */
function ensemble(gust: number, gustWeight = 1, nominalWeight = 1): WindScenario[] {
  return [
    { label: "headwind", weight: nominalWeight, ctx: context(-6) },
    { label: "gust", weight: gustWeight, ctx: context(gust) },
  ];
}

/** Downrange component of a scenario's miss: negative is short, positive is long. */
function downrangeMiss(vector: readonly number[] | null): number {
  expect(vector).not.toBeNull();
  return (vector as readonly number[])[0] as number;
}

describe("robustAim — THE VALIDATION CRITERION (P5.17)", () => {
  it("puts the robust aim measurably away from the nominal one in a headwind-vs-gust ensemble", () => {
    const result = robustAim(problem(400), ensemble(-16), { vary: "theta" });

    // The baseline is a genuine hit, checked from the outside on the returned
    // aim rather than taken from the inner solver's own verdict.
    expect(result.status).toBe("converged");
    expect(result.nominalMiss).toBeLessThan(1e-6);
    expect(result.nominalAim.theta).toBeCloseTo(0.6339044229, 8);
    expect(result.nominalAim.speed).toBeCloseTo(104.9387636174, 6);

    // THE MEASUREMENT. Robust elevation is 0.0754 rad (4.32°) below nominal at
    // the same launch speed.
    expect(result.aim.theta).toBeCloseTo(0.5584788851, 7);
    expect(result.shift.theta).toBeCloseTo(-0.0754255378, 7);
    expect(Math.abs(result.shift.theta)).toBeGreaterThan(0.07);

    // `vary: "theta"` holds the speed exactly, not approximately.
    expect(result.aim.speed).toBe(result.nominalAim.speed);
    expect(result.shift.speed).toBe(0);

    // And it buys what it is supposed to buy: RMS miss 45.489 m → 43.106 m.
    expect(result.nominalRisk).toBeCloseTo(45.48903908, 5);
    expect(result.risk).toBeCloseTo(43.105853, 4);
    expect(result.riskReduction).toBeGreaterThan(2.38);
    expect(result.risk).toBeLessThan(result.nominalRisk);

    // Per-scenario: the nominal aim is exact under the nominal wind and 64.33 m
    // short under the gust; the robust aim gives up 2.67 m to recover 3.43 m.
    expect(result.nominalMisses[0]?.miss).toBeLessThan(1e-6);
    expect(result.nominalMisses[1]?.miss).toBeCloseTo(64.3312160063, 5);
    expect(result.misses[0]?.miss).toBeCloseTo(2.668864, 4);
    expect(result.misses[1]?.miss).toBeCloseTo(60.902432, 4);
    expect(result.misses[1]?.miss).toBeLessThan(result.nominalMisses[1]?.miss as number);

    expect(result.riskMeasure).toBe("mean-square");
    expect(result.varied).toBe("theta");
  });

  it("makes the trade visible as a trade when the gust target is still reachable", () => {
    // At a −16 m/s gust the target is out of reach altogether, so both scenarios
    // fall short and the robust aim is damage limitation. At −7 m/s it is a real
    // two-sided balance, which is the more informative picture.
    const result = robustAim(problem(400), ensemble(-7), { vary: "theta" });

    expect(result.status).toBe("converged");
    const nominalUnderNominal = downrangeMiss(result.nominalMisses[0]?.missVector ?? null);
    const nominalUnderGust = downrangeMiss(result.nominalMisses[1]?.missVector ?? null);
    const robustUnderNominal = downrangeMiss(result.misses[0]?.missVector ?? null);
    const robustUnderGust = downrangeMiss(result.misses[1]?.missVector ?? null);

    // Nominal: exact in the nominal wind, 6.46 m short in the gust. One-sided.
    expect(Math.abs(nominalUnderNominal)).toBeLessThan(1e-6);
    expect(nominalUnderGust).toBeCloseTo(-6.458, 2);

    // Robust: now slightly LONG in the nominal wind, and less short in the gust.
    // The sign flip is the trade.
    expect(robustUnderNominal).toBeGreaterThan(0);
    expect(robustUnderGust).toBeGreaterThan(nominalUnderGust);
    expect(Math.abs(robustUnderGust)).toBeLessThan(Math.abs(nominalUnderGust));
    expect(result.risk).toBeLessThan(result.nominalRisk);
  });
});

describe("robustAim — the shift is not an artefact", () => {
  it("collapses to exactly zero when the ensemble carries no uncertainty", () => {
    // One scenario means the risk *is* the miss, so its minimizer is the nominal
    // aim and the shift must vanish identically -- not merely be small.
    const result = robustAim(problem(400), [{ label: "only", weight: 1, ctx: context(-6) }], {
      vary: "theta",
    });

    expect(result.status).toBe("converged");
    expect(result.shift.theta).toBe(0);
    expect(result.shift.speed).toBe(0);
    expect(result.risk).toBeLessThan(1e-6);
    expect(result.riskReduction).toBe(0);
  });

  it("grows monotonically with the severity of the gust", () => {
    const shifts = [-7, -8, -9, -10, -16].map((gust) => {
      const result = robustAim(problem(400), ensemble(gust), { vary: "theta" });
      expect(result.status).toBe("converged");
      return Math.abs(result.shift.theta);
    });

    // Measured: 0.01522, 0.02178, 0.02839, 0.03504, 0.07543 rad.
    expect(shifts[0]).toBeCloseTo(0.01522, 4);
    expect(shifts[4]).toBeCloseTo(0.075426, 4);
    for (let i = 1; i < shifts.length; i += 1) {
      expect(shifts[i] as number).toBeGreaterThan(shifts[i - 1] as number);
    }
  });

  it("grows monotonically with the probability of the gust", () => {
    // Nominal weight pinned at 9; the gust gets 1, then 3, then 9. A rarer gust
    // should pull the aim less far from nominal.
    const thetas = [1, 3, 9].map((gustWeight) => {
      const result = robustAim(problem(400), ensemble(-16, gustWeight, 9), { vary: "theta" });
      expect(result.status).toBe("converged");
      return result.aim.theta;
    });

    // Measured: 0.5706031, 0.5629515, 0.5584789 -- decreasing, i.e. further from
    // the nominal 0.6339044 each time.
    expect(thetas[0]).toBeCloseTo(0.570603, 5);
    expect(thetas[2]).toBeCloseTo(0.5584789, 5);
    for (let i = 1; i < thetas.length; i += 1) {
      expect(thetas[i] as number).toBeLessThan(thetas[i - 1] as number);
    }
  });

  it("depends on the weights only through their ratio", () => {
    const equal = robustAim(problem(400), ensemble(-16, 1, 1), { vary: "theta" });
    const scaled = robustAim(problem(400), ensemble(-16, 7, 7), { vary: "theta" });

    // Bit-identical, not merely close: normalization happens before anything
    // numerical, so scaling every weight by 7 cannot change a single operation.
    expect(scaled.aim.theta).toBe(equal.aim.theta);
    expect(scaled.risk).toBe(equal.risk);
    expect(scaled.misses.map((entry) => entry.weight)).toEqual([0.5, 0.5]);
  });

  it("is reproducible", () => {
    const first = robustAim(problem(400), ensemble(-16), { vary: "theta" });
    const second = robustAim(problem(400), ensemble(-16), { vary: "theta" });
    expect(second.aim).toEqual(first.aim);
    expect(second.risk).toBe(first.risk);
    expect(second.integrations).toBe(first.integrations);
  });
});

describe("robustAim — risk measures", () => {
  it("moves the aim furthest for worst-case and least for mean-absolute", () => {
    const shifts = (["mean-absolute", "mean-square", "worst-case"] as const).map((risk) => {
      const result = robustAim(problem(400), ensemble(-16), { vary: "theta", risk });
      expect(result.status).toBe("converged");
      expect(result.riskMeasure).toBe(risk);
      return Math.abs(result.shift.theta);
    });

    // Measured: 0.04233, 0.07543, 0.07856 rad. Mean-absolute weights the large
    // miss linearly and so tolerates it; worst-case sees nothing else.
    expect(shifts[0]).toBeCloseTo(0.04233, 4);
    expect(shifts[1]).toBeCloseTo(0.075426, 4);
    expect(shifts[2]).toBeCloseTo(0.078561, 4);
    expect(shifts[0] as number).toBeLessThan(shifts[1] as number);
    expect(shifts[1] as number).toBeLessThan(shifts[2] as number);
  });

  it("reports every measure in metres, so worst-case bounds the others", () => {
    const results = (["mean-absolute", "mean-square", "worst-case"] as const).map((risk) =>
      robustAim(problem(400), ensemble(-16), { vary: "theta", risk }),
    );
    for (const result of results) {
      const worst = Math.max(...result.misses.map((entry) => entry.miss as number));
      const mean = result.misses.reduce(
        (sum, entry) => sum + entry.weight * (entry.miss as number),
        0,
      );
      expect(result.risk).toBeLessThanOrEqual(worst + 1e-9);
      expect(result.risk).toBeGreaterThanOrEqual(mean - 1e-9);
    }
  });
});

describe("robustAim — THE UNBOUNDEDNESS of the two-variable problem", () => {
  it("runs away to a flat, fast shot when nothing bounds the aim", () => {
    // Not a bug and not a tolerance to tighten: wind acts for as long as the
    // shot is airborne, so risk decreases without limit as the time of flight
    // does. The infimum is 0 and is not attained, so the optimizer cannot
    // converge and should not be made to.
    const result = robustAim(problem(400), ensemble(-16));

    expect(result.varied).toBe("both");
    expect(result.optimizer.converged).toBe(false);
    expect(result.status).toBe("not-converged");
    expect(result.aim.speed).toBeGreaterThan(1000);
    expect(result.aim.theta).toBeLessThan(0.01);
    // Still descending when it was stopped: far below the nominal aim's risk.
    expect(result.risk).toBeLessThan(1);
    expect(result.nominalRisk).toBeCloseTo(45.489039, 4);
  });

  it("lands on the speed cap, not inside the box, once bounded", () => {
    const bounds = { thetaMin: 0.05, thetaMax: 1.4, speedMin: 60, speedMax: 110 };
    const result = robustAim(problem(400), ensemble(-16), { bounds });

    expect(robustAimIsFeasible(result, bounds)).toBe(true);
    // The descent direction still points at more speed, so the answer sits on
    // the face. Bounds make it finite; they do not make it interior.
    expect(result.aim.speed).toBeCloseTo(110, 6);
    // More speed than the fixed-speed form is allowed, hence lower risk than the
    // 43.106 m that form achieves.
    expect(result.risk).toBeLessThan(43.1);
    expect(result.risk).toBeCloseTo(33.508712, 3);
  });

  it("can vary the launch speed alone, holding elevation exactly", () => {
    const result = robustAim(problem(400), ensemble(-16), { vary: "speed" });
    expect(result.varied).toBe("speed");
    expect(result.shift.theta).toBe(0);
    expect(result.aim.theta).toBe(result.nominalAim.theta);
    expect(result.aim.speed).toBeGreaterThan(result.nominalAim.speed);
    expect(result.risk).toBeLessThan(result.nominalRisk);
  });
});

describe("robustAim — failures are reported, not smoothed over", () => {
  it("reports a null miss and a NaN risk when a flight does not land", () => {
    // A time span far too short for any impact. NaN is the documented signal
    // Nelder-Mead reads as "inadmissible"; a large finite penalty would invent a
    // gradient the physics never produced.
    const result = robustAim(problem(400, { tspan: [0, 0.01] }), ensemble(-16), {
      vary: "theta",
      nelderMead: { maxIterations: 5 },
    });

    expect(result.misses.every((entry) => entry.miss === null)).toBe(true);
    expect(result.misses.every((entry) => entry.missVector === null)).toBe(true);
    expect(Number.isNaN(result.risk)).toBe(true);
    expect(Number.isNaN(result.nominalMiss)).toBe(true);
    expect(result.status).toBe("nominal-failed");
  });

  it("still returns the optimization when the nominal baseline misses", () => {
    // vary: "theta" with a speed too low to reach the target: every elevation
    // misses, so the baseline is not a hit and the comparison is compromised --
    // but the result is returned and says so, rather than throwing.
    const result = robustAim(problem(400), ensemble(-16), {
      vary: "theta",
      initialAim: { theta: 0.7, speed: 40 },
    });

    expect(result.status).toBe("nominal-failed");
    expect(result.nominalMiss).toBeGreaterThan(1);
    expect(result.aim.speed).toBe(40);
    expect(Number.isFinite(result.risk)).toBe(true);
  });

  it("counts every trajectory it integrated", () => {
    const result = robustAim(problem(400), ensemble(-16), { vary: "theta" });
    // Two scenarios per objective evaluation, plus the nominal solve and the two
    // reporting passes, so the count strictly exceeds evaluations × scenarios.
    expect(result.integrations).toBeGreaterThan(result.optimizer.evaluations * 2);
    expect(Number.isInteger(result.integrations)).toBe(true);
  });
});

describe("robustAim — input validation", () => {
  it("rejects an empty ensemble", () => {
    expect(() => robustAim(problem(400), [])).toThrow(/ensemble is empty/);
  });

  it("rejects a zero or negative weight rather than normalizing it away", () => {
    expect(() => robustAim(problem(400), [{ label: "zero", weight: 0, ctx: context(-6) }])).toThrow(
      /strictly positive/,
    );
    expect(() =>
      robustAim(problem(400), [{ label: "negative", weight: -1, ctx: context(-6) }]),
    ).toThrow(/strictly positive/);
  });

  it("rejects a non-finite weight", () => {
    expect(() =>
      robustAim(problem(400), [{ label: "nan", weight: Number.NaN, ctx: context(-6) }]),
    ).toThrow(/non-finite weight/);
  });

  it("rejects a nominalIndex outside the ensemble", () => {
    expect(() => robustAim(problem(400), ensemble(-16), { nominalIndex: 2 })).toThrow(
      /not an index into an ensemble of 2/,
    );
    expect(() => robustAim(problem(400), ensemble(-16), { nominalIndex: -1 })).toThrow(
      /not an index into an ensemble of 2/,
    );
  });

  it("delegates bound validation to P5.16 rather than restating it", () => {
    expect(() =>
      robustAim(problem(400), ensemble(-16), {
        bounds: { speedMin: 120, speedMax: 60 },
      }),
    ).toThrow();
  });

  it("names the offending scenario by its label", () => {
    expect(() =>
      robustAim(problem(400), [
        { label: "headwind", weight: 1, ctx: context(-6) },
        { label: "the-bad-one", weight: 0, ctx: context(-16) },
      ]),
    ).toThrow(/the-bad-one/);
  });
});
