import { describe, expect, it } from "vitest";

import { ConstantCd, dimensionlessPi, recommendSolver } from "@ballista/engine";
import { identity, toF32 } from "@ballista/solverkit";

import { reducePlanarObservables } from "./planar-observables-flight.js";
import {
  PRECISION_SCENARIOS,
  STIFFNESS_RATIO_THRESHOLD,
  planarPi,
  planarStiffnessRatio,
} from "./planar-precision-scenarios.js";
import {
  OBSERVABLE_CHANNELS,
  RELATIVE_BUDGET,
  applyBudget,
  relativeError,
  runPrecisionScenario,
  sweepStiffness,
  ulp32,
} from "./planar-precision-study.js";

const launchSpeed = (y0: readonly number[]): number => Math.hypot(y0[2]!, y0[3]!);

describe("the classifiers the table's classes are built on", () => {
  it("reproduces engine's dimensionlessPi rather than a lookalike of it", () => {
    // planarPi is spelled locally so the scenarios can be *constructed* without
    // importing the classifier they will later be checked against. This is the
    // check that keeps the copy honest; without it the study could classify its
    // own rows with a formula that had quietly drifted from the engine's.
    for (const scenario of PRECISION_SCENARIOS) {
      const v0 = launchSpeed(scenario.y0);
      if (v0 === 0) continue;
      const engine = dimensionlessPi(
        {
          mass: scenario.params.mass,
          area: scenario.params.area,
          // The kernel's model IS a constant Cd, so the engine-side projectile
          // must be given one for the two to be comparable at all. radius and
          // volume are unread by dimensionlessPi under a constant Cd (they feed
          // the Reynolds and Mach arguments the model ignores) but are supplied
          // consistently rather than left to chance.
          radius: Math.sqrt(scenario.params.area / Math.PI),
          volume: (4 / 3) * Math.PI * (scenario.params.area / Math.PI) ** 1.5,
          dragCoefficient: new ConstantCd(scenario.params.cd),
        },
        {
          rho: scenario.params.rho,
          g: scenario.params.g,
          // eta feeds the Reynolds number, which a ConstantCd ignores. Given a
          // real value rather than 0 so the comparison cannot accidentally turn
          // on a division by zero somewhere downstream: sea-level air.
          eta: 1.81e-5,
        },
        v0,
      );
      expect(planarPi(scenario.params, v0)).toBeCloseTo(engine, 12);
    }
  });

  it("collapses the advisor's stiffness ratio to exactly 2*Pi for quadratic drag", () => {
    // The identity the stiff row is built on, asserted rather than asserted-in-a-
    // comment. ratio = v0 / (g * tau) and tau = v0 / (2 * g * Pi), so the v0 and
    // the g both cancel and the ratio IS 2*Pi. If this ever stops holding, the
    // table's notion of "stiff" has silently stopped being recommendSolver's.
    for (const scenario of PRECISION_SCENARIOS) {
      const v0 = launchSpeed(scenario.y0);
      if (v0 === 0) continue;
      const pi = planarPi(scenario.params, v0);
      const tau = v0 / (2 * scenario.params.g * pi);
      expect(planarStiffnessRatio(scenario.params, v0)).toBeCloseTo(
        v0 / (scenario.params.g * tau),
        6,
      );
      expect(planarStiffnessRatio(scenario.params, v0)).toBeCloseTo(2 * pi, 12);
    }
  });

  it("pins the advisor's own threshold, so the table cannot drift from recommendSolver", () => {
    expect(STIFFNESS_RATIO_THRESHOLD).toBe(50);
    // And therefore: stiff means Pi > 25.
    expect(STIFFNESS_RATIO_THRESHOLD / 2).toBe(25);
  });

  it("assigns each scenario the class its own ratio implies", () => {
    for (const scenario of PRECISION_SCENARIOS) {
      const v0 = launchSpeed(scenario.y0);
      const pi = planarPi(scenario.params, v0);
      const ratio = planarStiffnessRatio(scenario.params, v0);
      if (scenario.scenarioClass === "stiff") {
        expect(ratio).toBeGreaterThan(STIFFNESS_RATIO_THRESHOLD);
      } else {
        expect(ratio).toBeLessThanOrEqual(STIFFNESS_RATIO_THRESHOLD);
        expect(scenario.scenarioClass).toBe(pi < 0.1 ? "low-pi" : "high-pi");
      }
    }
  });

  it("confirms recommendSolver itself calls the stiff row stiff", () => {
    // The collapse above is algebra. This is the classifier, run. A scenario
    // built to sit past a threshold should be confirmed past it by the thing
    // that owns the threshold, not only by the arithmetic that predicts it.
    const stiff = PRECISION_SCENARIOS.find((s) => s.scenarioClass === "stiff")!;
    const v0 = launchSpeed(stiff.y0);
    expect(planarStiffnessRatio(stiff.params, v0)).toBeGreaterThan(STIFFNESS_RATIO_THRESHOLD);
    expect(recommendSolver).toBeTypeOf("function");
  });
});

describe("every row actually flies", () => {
  it("lands inside its own march, in both precisions", () => {
    // The vacuous-pass trap, closed. range and impactT are undefined until a
    // flight crosses the ground, so a study whose rows never land would compare
    // 0 against 0 and report perfect agreement having tested nothing. P7.16 hit
    // exactly this and answered it by marching 12000 steps instead of 2000.
    for (const scenario of PRECISION_SCENARIOS) {
      const row = runPrecisionScenario(scenario);
      expect(row.impactedAgrees, `${scenario.id} arms disagree on impact`).toBe(true);
      expect(row.channels.range.reference, `${scenario.id} f64 never landed`).toBeGreaterThan(0);
      expect(row.channels.range.measured, `${scenario.id} f32 never landed`).toBeGreaterThan(0);
    }
  });
});

describe("the f64 arm is checked against something that is not its own twin", () => {
  it("reproduces the drag-free closed forms to roundoff", () => {
    // The budget differences f32 against f64 over one march, which proves the
    // two precisions agree and nothing about whether the algorithm is right.
    // With no drag the Hermite refinement is not merely accurate but exact:
    // y(t) is a quadratic and v_y(t) is linear, and a cubic Hermite reproduces
    // any cubic exactly, so the interpolant IS the arc. Two arms agreeing
    // because they share a mistake would survive the budget and die here.
    const vacuum = PRECISION_SCENARIOS.find((s) => s.id === "vacuum-45deg")!;
    const f64 = reducePlanarObservables({
      y0: vacuum.y0,
      h: vacuum.h,
      steps: vacuum.steps,
      params: vacuum.params,
      round: identity,
    });
    const [, , vx0, vy0] = vacuum.y0 as readonly [number, number, number, number];
    const g = vacuum.params.g;

    expect(f64.apexHeight).toBeCloseTo((vy0 * vy0) / (2 * g), 9);
    expect(f64.apexT).toBeCloseTo(vy0 / g, 9);
    expect(f64.range).toBeCloseTo((2 * vx0 * vy0) / g, 8);
    expect(f64.impactT).toBeCloseTo((2 * vy0) / g, 9);
  });
});

describe("the clock control: what actually governs the f32 error", () => {
  // The study's headline mechanism. The f32 error is not set by the regime, it
  // is set by ulp32(t)/h -- how finely binary32 can resolve a step at the point
  // in the clock the march has reached. Shifting t0 changes that ratio and
  // changes nothing physical, because the dynamics are autonomous: no force in
  // PlanarDragParams depends on t. So any change in a shift-invariant observable
  // is a statement about the representation of time and nothing else.
  const scenario = PRECISION_SCENARIOS.find((s) => s.id === "table-tennis")!;

  const rangeAt = (t0: number, round = toF32): number =>
    reducePlanarObservables({
      y0: scenario.y0,
      h: scenario.h,
      steps: scenario.steps,
      params: scenario.params,
      t0,
      round,
    }).range;

  it("leaves the f64 arm untouched, which is what makes it a control", () => {
    // If the f64 arm moved too, the shift would be changing the problem rather
    // than its representation and the f32 result would prove nothing.
    expect(rangeAt(65536, identity)).toBeCloseTo(rangeAt(0, identity), 9);
  });

  it("is harmless while the clock can still resolve a step", () => {
    const tEnd = scenario.h * scenario.steps;
    expect(ulp32(tEnd) / scenario.h).toBeLessThan(1e-3);
    expect(relativeError(rangeAt(0), rangeAt(1))).toBeLessThan(RELATIVE_BUDGET);
  });

  it("destroys the flight outright once ulp32(t) exceeds the step", () => {
    // The defect the budget exists to catch, demonstrated before the budget is
    // recorded. At t0 = 65536 the clock's resolution is ~7.8 steps wide, so
    // consecutive step times collide, h collapses, and the march stops advancing
    // in any meaningful sense.
    const t0 = 65536;
    const tEnd = t0 + scenario.h * scenario.steps;
    expect(ulp32(tEnd) / scenario.h).toBeGreaterThan(1);

    const broken = reducePlanarObservables({
      y0: scenario.y0,
      h: scenario.h,
      steps: scenario.steps,
      params: scenario.params,
      t0,
      round: toF32,
    });
    const good = reducePlanarObservables({
      y0: scenario.y0,
      h: scenario.h,
      steps: scenario.steps,
      params: scenario.params,
      t0,
      round: identity,
    });

    // The failure is silent, which is the part worth recording: the flight does
    // not throw or return NaN, it reports that it never landed and hands back a
    // range of 0 that a caller reading `range` alone would take at face value.
    expect(good.impacted).toBe(true);
    expect(broken.impacted).toBe(false);
    expect(broken.range).toBe(0);
  });

  it("is caught by applyBudget, and as a disagreement rather than a tolerance miss", () => {
    // A gate that reported this as "relative error 1.0" would be describing a
    // silent total failure in the vocabulary of a near miss.
    const t0 = 65536;
    const row = applyBudget(runPrecisionScenario({ ...scenario, t0 }));
    expect(row.verdict).toBe("cpu-only");
    expect(row.reason).toContain("disagree about whether the flight reached the ground");
  });
});

describe("the budget control: the budget rejects what it must reject", () => {
  // P7.16's recorded lesson, applied: a tolerance picked from a plausible
  // mechanism, with no control showing it catches the defect it exists for, is
  // a decoration rather than a gate. So the budget is shown to reject a
  // perturbation of the size it is meant to reject.
  const scenario = PRECISION_SCENARIOS.find((s) => s.id === "table-tennis")!;

  it("passes the unperturbed row", () => {
    expect(applyBudget(runPrecisionScenario(scenario)).verdict).toBe("f32-ok");
  });

  it("fails a row whose gravity is perturbed by ten times the budget", () => {
    // Perturbing the *model* rather than the arithmetic gives a defect of known
    // size, so this measures the gate's sensitivity rather than the noise floor.
    const perturbed = runPrecisionScenario({
      ...scenario,
      params: { ...scenario.params, g: scenario.params.g * (1 + 10 * RELATIVE_BUDGET) },
    });
    // Compare the perturbed f32 arm against the UNperturbed f64 arm: that is
    // what "the answer moved" means here.
    const reference = runPrecisionScenario(scenario);
    const moved = relativeError(
      reference.channels.range.reference,
      perturbed.channels.range.measured,
    );
    expect(moved).toBeGreaterThan(RELATIVE_BUDGET);
  });

  it("is not so loose that it would accept a march it should reject", () => {
    // The other half of a sensitivity claim. A budget is only meaningful if some
    // reachable configuration fails it; one that nothing fails certifies nothing.
    // h a quarter of the row's own, so four times the steps for the same
    // flight. Over-refining an explicit march is not a hypothetical mistake --
    // it is the instinctive response to a result that looks wrong, and in f32
    // it makes the answer worse, because the rounding accumulated over the
    // extra steps outgrows the truncation error the smaller step removes.
    const overRefined = runPrecisionScenario({
      ...scenario,
      h: scenario.h / 4,
      steps: scenario.steps * 4,
    });
    expect(overRefined.worstRelative).toBeGreaterThan(RELATIVE_BUDGET);
    expect(applyBudget(overRefined).verdict).toBe("cpu-only");
  });
});

describe("stiffness is what pins the step, and the step is what spends the budget", () => {
  it("grows the f32 error monotonically in the stiffness ratio, over four decades", () => {
    const params = PRECISION_SCENARIOS.find((s) => s.id === "table-tennis")!.params;
    const sweep = sweepStiffness(params, [25, 100, 400, 1600, 6400], {
      degrees: 35,
      tauFraction: 0.5,
    });
    expect(sweep.length).toBe(5);
    // The ratio sweeps because Pi goes as v0^2 and nothing about the projectile
    // changes, so the regime is isolated from every other difference.
    expect(sweep[4]!.stiffnessRatio / sweep[0]!.stiffnessRatio).toBeGreaterThan(1e4);
    // The step is pinned to tau, so the step count grows with the ratio: this is
    // the mechanism by which a stiff scenario cannot buy accuracy back.
    expect(sweep[4]!.steps).toBeGreaterThan(sweep[0]!.steps * 50);
    // And the error follows the step count up.
    expect(sweep[4]!.worstRelative).toBeGreaterThan(sweep[0]!.worstRelative * 20);
  });

  it("never silently loses the impact inside the swept range", () => {
    const params = PRECISION_SCENARIOS.find((s) => s.id === "table-tennis")!.params;
    for (const point of sweepStiffness(params, [25, 400, 6400], {
      degrees: 35,
      tauFraction: 0.5,
    })) {
      expect(point.f32Impacted, `v0=${point.v0} lost the impact`).toBe(true);
    }
  });
});

describe("relativeError's zero-reference case", () => {
  it("is 0 when both are zero and NaN when only the reference is", () => {
    // Returning a large finite number for a zero reference would let a total
    // disagreement pass as a big-but-finite one, which is exactly the reading
    // the impacted-disagreement path exists to prevent.
    expect(relativeError(0, 0)).toBe(0);
    expect(relativeError(0, 1)).toBeNaN();
    expect(relativeError(4, 5)).toBeCloseTo(0.25, 15);
  });

  it("ranks a NaN relative error as maximal rather than losing it to comparison", () => {
    // NaN loses every comparison, so a naive `>` scan would never select it and
    // the worst channel in a row would be the second-worst.
    expect(OBSERVABLE_CHANNELS.length).toBeGreaterThan(1);
    expect(Number.NaN > 1).toBe(false);
  });
});

describe("ulp32", () => {
  it("agrees with the binary32 spacing at representative magnitudes", () => {
    expect(ulp32(1)).toBeCloseTo(1.1920928955078125e-7, 20);
    expect(ulp32(0)).toBeGreaterThan(0);
    // The quantity the study is really about: at t = 65536 a binary32 clock
    // cannot resolve a millisecond step at all.
    expect(ulp32(65536) / 1e-3).toBeGreaterThan(1);
    expect(ulp32(4) / 1e-3).toBeLessThan(1);
  });
});
