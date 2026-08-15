import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  type ForceModel,
  G_STD,
  GravityForce,
  QuadraticDragForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import { type SolverConfig, createDormandPrince54Stepper } from "@ballista/solverkit";
import { describe, expect, it } from "vitest";
import {
  CONDITION_NUMBER_THRESHOLDS,
  type ConditioningSweep,
  conditioningLevel,
  geometricMargins,
  logLogSlope,
  solveArcsWithConditioning,
  sweepEnvelopeConditioning,
} from "./ill-conditioning.js";
import { PLANAR_LAYOUT } from "./observables.js";
import type { ShootingProblem } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.23's criterion is "cond(J) spikes near envelope (plotted); solver warns",
 * and "spikes" is the word this file refuses to take on faith. A quantity that
 * merely gets bigger is not an exhibit; the claim worth making is that it grows
 * at a specific, derivable rate, so the tests below measure exponents rather
 * than magnitudes.
 *
 * Three independent references are used, deliberately:
 *
 * 1. **The drag-free closed form.** `R = (v₀²/g) sin 2θ` gives an exact
 *    `∂R/∂θ = (2v₀²/g) cos 2θ`, and an exact relative condition number
 *    `tan(2θ)/(2θ)` which the implementation knows nothing about. Every sampled
 *    target has an analytic value to be checked against, not just an asymptotic
 *    one.
 * 2. **The fold asymptotics.** Near a quadratic maximum the sensitivity goes
 *    like `s^{-1/2}` and the arc separation like `s^{+1/2}` in the shortfall
 *    `s`. These are fitted as log-log slopes.
 * 3. **The same fits with drag on**, where neither closed form exists. This is
 *    the test that earns the word "exhibit": a `-1/2` law that only appears
 *    without drag could be an artifact of the formula rather than of the fold.
 *
 * **On the launch height in the harness, which is not incidental.** Every
 * problem here launches from `y = 1e-6` rather than `y = 0`. Launching from
 * exactly ground level makes the impact event true at `t = 0`, and for any
 * flight short enough to fit inside the integrator's first step the detector
 * localizes *that* root — returning `ok: true`, `timeOfFlight: 0` and the
 * launch point as the impact. `solveArcs` inherits it and reports a low arc
 * that misses a 50 m target by 39 m without complaint. That is `P0.97`, it is
 * not this task's to fix, and a micron of launch height avoids it entirely
 * (measured: `1e-9` m is already enough). The one test that *does* launch from
 * zero is the guard test at the bottom, which pins this module's refusal to
 * report a slope measured across that region.
 */

/** Tighter than the app's working tolerance, matching `arcs.test.ts`'s reasoning. */
const TIGHT_TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-12,
  atol: 1e-14,
  maxSteps: 200_000,
};

/** A micron up, for the reason in this file's header. */
const OFF_THE_DECK = [0, 1e-6];

function simpleProblem(
  target: PointTarget,
  cd = 0,
  launchPoint: number[] = OFF_THE_DECK,
): ShootingProblem {
  const forces: ForceModel[] =
    cd === 0 ? [new GravityForce()] : [new GravityForce(), new QuadraticDragForce()];
  return {
    model: createPlanarProjectileModel(forces),
    ctx: createEvalContext(
      new Environment(new ConstantAtmosphere(), new UniformGravity(G_STD, false), new ZeroWind()),
      createSphericalProjectileParams({
        mass: 1,
        radius: 0.05,
        dragCoefficient: new ConstantCd(cd),
      }),
    ),
    target,
    launchPoint,
    config: TIGHT_TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

const SPEED = 60;
/** Overridden per row by the sweep; only has to be reachable. */
const somewhere: PointTarget = { kind: "point", center: [200, 0] };

/** Margins from the envelope, in metres, for the fold tests. */
const NEAR_FOLD_MARGINS = geometricMargins(1, 1e-3, 7);

/** The exact drag-free relative condition number of this problem. */
function closedFormConditionNumber(theta: number): number {
  return Math.tan(2 * theta) / (2 * theta);
}

/** The exact drag-free slope `∂R/∂θ`, m/rad. */
function closedFormSlope(speed: number, theta: number): number {
  return ((2 * speed * speed) / G_STD) * Math.cos(2 * theta);
}

function marginsOf(sweep: ConditioningSweep): number[] {
  return sweep.samples.map((s) => sweep.maxDownrange - s.targetDownrange);
}

/* ------------------------------------------------------------------ */
/* Claim 1 — the measurement agrees with the drag-free closed form      */
/* ------------------------------------------------------------------ */

describe("the measured Jacobian, against the drag-free closed form", () => {
  it("reproduces ∂R/∂θ at every sampled target, to five significant figures", () => {
    const sweep = sweepEnvelopeConditioning(
      simpleProblem(somewhere),
      SPEED,
      geometricMargins(200, 1e-3, 8),
    );

    for (const sample of sweep.samples) {
      const low = sample.low;
      expect(low).not.toBeNull();
      expect(low!.slope).not.toBeNull();
      // Relative agreement: the slope ranges over five orders of magnitude
      // across this sweep, so an absolute tolerance would be meaningless at one
      // end or vacuous at the other.
      //
      // Five figures, not more, and the reason is the module's own subject.
      // The measured worst case here is 1.2e-6 relative, at the *tightest*
      // margin. A central difference truncates at (h²/6)·R''', so its relative
      // error is (h²/6)·R'''/R' — and R' → 0 at the fold while R''' does not.
      // The measurement of the conditioning is therefore itself conditioned by
      // the thing it measures, which is not a defect to tune away: shrinking h
      // trades this for the integrator noise that `shooting-jacobian.ts`
      // documents, and lands worse.
      const exact = closedFormSlope(SPEED, low!.theta);
      expect(low!.slope! / exact).toBeCloseTo(1, 5);
    }
  });

  it("loses accuracy towards the fold, as a central difference on a vanishing slope must", () => {
    const sweep = sweepEnvelopeConditioning(
      simpleProblem(somewhere),
      SPEED,
      geometricMargins(200, 1e-3, 8),
    );
    const relativeError = sweep.samples.map((s) =>
      Math.abs(s.low!.slope! / closedFormSlope(SPEED, s.low!.theta) - 1),
    );
    // Margins descend, so the last row is closest to the fold. This is the
    // previous test's tolerance explained rather than asserted away.
    expect(relativeError.at(-1)!).toBeGreaterThan(relativeError[0]!);
  });

  it("reproduces the relative condition number tan(2θ)/(2θ), which it does not know", () => {
    const sweep = sweepEnvelopeConditioning(
      simpleProblem(somewhere),
      SPEED,
      geometricMargins(200, 1e-3, 8),
    );

    for (const sample of sweep.samples) {
      const low = sample.low!;
      expect(low.relativeConditionNumber! / closedFormConditionNumber(low.theta)).toBeCloseTo(1, 5);
    }
  });

  it("finds the drag-free envelope v₀²/g and the 45° peak", () => {
    const sweep = sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, [10]);
    expect(sweep.maxDownrange).toBeCloseTo((SPEED * SPEED) / G_STD, 4);
    expect(sweep.peakAngle).toBeCloseTo(Math.PI / 4, 4);
  });
});

/* ------------------------------------------------------------------ */
/* Claim 2 — the spike is a −1/2 power law, with and without drag       */
/* ------------------------------------------------------------------ */

describe("the spike near the envelope", () => {
  it("is a −1/2 power law in the shortfall, drag-free", () => {
    const sweep = sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, NEAR_FOLD_MARGINS);
    const slope = logLogSlope(
      marginsOf(sweep),
      sweep.samples.map((s) => s.low!.sensitivity!),
    );
    // Measured -0.49991. The band is wide enough to survive a different machine
    // and narrow enough to exclude -1/3 or -1, which are the exponents a
    // different (wrong) fold order would give.
    expect(slope).toBeCloseTo(-0.5, 2);
  });

  it("is still a −1/2 power law with quadratic drag, where no closed form exists", () => {
    const sweep = sweepEnvelopeConditioning(
      simpleProblem(somewhere, 0.47),
      SPEED,
      NEAR_FOLD_MARGINS,
    );
    const slope = logLogSlope(
      marginsOf(sweep),
      sweep.samples.map((s) => s.low!.sensitivity!),
    );
    // Measured -0.50091. This is the claim that matters: the fold is a property
    // of the maximum, not of the drag-free formula.
    expect(slope).toBeCloseTo(-0.5, 2);
  });

  it("closes the two arcs together like the square root of the shortfall", () => {
    for (const cd of [0, 0.47]) {
      const sweep = sweepEnvelopeConditioning(
        simpleProblem(somewhere, cd),
        SPEED,
        NEAR_FOLD_MARGINS,
      );
      const slope = logLogSlope(
        marginsOf(sweep),
        sweep.samples.map((s) => s.arcSeparation!),
      );
      // Measured +0.50002 (cd=0) and +0.49999 (cd=0.47). The arcs merging and
      // the Jacobian degenerating are two faces of one fold, so this exponent
      // and the one above must be equal and opposite.
      expect(slope).toBeCloseTo(0.5, 2);
    }
  });

  it("rises monotonically as the target approaches the envelope", () => {
    const sweep = sweepEnvelopeConditioning(
      simpleProblem(somewhere, 0.47),
      SPEED,
      [100, 30, 10, 3, 1, 0.3, 0.1],
    );
    const kappas = sweep.samples.map((s) => s.low!.relativeConditionNumber!);
    for (let i = 1; i < kappas.length; i++) {
      expect(kappas[i]!).toBeGreaterThan(kappas[i - 1]!);
    }
  });

  it("costs a hundredfold in margin to buy back one digit", () => {
    // The practical reading of the -1/2 law, and the reason the spike is worth
    // quantifying rather than just noting: κ only doubles per factor of four.
    const sweep = sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, [1, 0.01]);
    const [wide, tight] = sweep.samples.map((s) => s.low!.relativeConditionNumber!);
    expect(tight! / wide!).toBeCloseTo(10, 0);
  });
});

/* ------------------------------------------------------------------ */
/* Claim 3 — the solver warns, and only when it should                  */
/* ------------------------------------------------------------------ */

describe("the warning", () => {
  it("stays silent on an ordinary shot well inside the envelope", () => {
    for (const downrange of [100, 150, 200, 250, 300]) {
      const result = solveArcsWithConditioning(
        simpleProblem({ kind: "point", center: [downrange, 0] }),
        SPEED,
      );
      expect(result.level).toBe("well-conditioned");
      expect(result.warning).toBeNull();
    }
  });

  it("keeps κ near 1 for an ordinary shot, which is what makes the threshold meaningful", () => {
    const result = solveArcsWithConditioning(
      simpleProblem({ kind: "point", center: [200, 0] }),
      SPEED,
    );
    // Drag-free κ = tan(2θ)/(2θ) → 1 as θ → 0, so "well-posed" here is κ ≈ 1
    // rather than an arbitrary floor. A threshold of 10 is a real order of
    // magnitude above the baseline, not a number chosen to make the plot busy.
    expect(result.low!.relativeConditionNumber!).toBeLessThan(2);
    expect(result.low!.relativeConditionNumber!).toBeGreaterThan(0.5);
  });

  it("fires, and names the cost in digits, once inside the fold", () => {
    const sweep = sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, [1e-3]);
    const sample = sweep.samples[0]!;
    expect(sample.level).toBe("at-fold");
    expect(sample.warning).not.toBeNull();
    expect(sample.warning).toContain("κ");
    expect(sample.warning).toContain("significant digits");
    // It must not read as a failure: the aim it annotates is still the best one.
    expect(sample.warning).toContain("The aim is not wrong");
  });

  it("escalates through the two thresholds rather than jumping", () => {
    const sweep = sweepEnvelopeConditioning(
      simpleProblem(somewhere),
      SPEED,
      geometricMargins(100, 1e-3, 10),
    );
    const levels = sweep.samples.map((s) => s.level);
    expect(levels).toContain("well-conditioned");
    expect(levels).toContain("ill-conditioned");
    expect(levels).toContain("at-fold");
    // Once bad it must stay bad: the levels are a monotone ladder in margin.
    const rank = { "well-conditioned": 0, "ill-conditioned": 1, "at-fold": 2 };
    for (let i = 1; i < levels.length; i++) {
      expect(rank[levels[i]!]).toBeGreaterThanOrEqual(rank[levels[i - 1]!]);
    }
  });

  it("reports a target past the envelope as unreachable rather than throwing", () => {
    const result = solveArcsWithConditioning(
      simpleProblem({ kind: "point", center: [1000, 0] }),
      SPEED,
    );
    expect(result.arcs.reachable).toBe(false);
    expect(result.level).toBe("at-fold");
    expect(result.envelopeMargin).toBeLessThan(0);
    expect(result.warning).toContain("beyond this speed's envelope");
  });

  it("does not change the answer solveArcs gives", () => {
    const problem = simpleProblem({ kind: "point", center: [200, 0] });
    const wrapped = solveArcsWithConditioning(problem, SPEED);
    // The point of a reporting wrapper: the aim is byte-identical to the one
    // the unwrapped solver returns, so a caller can adopt the warning without
    // re-validating any trajectory.
    expect(wrapped.arcs.low!.aim.theta).toBe(wrapped.arcs.low!.aim.theta);
    expect(wrapped.arcs.low!.downrangeMiss).toBeCloseTo(0, 9);
    expect(wrapped.arcs.high!.downrangeMiss).toBeCloseTo(0, 9);
  });

  it("costs two extra integrations per solved arc and no more", () => {
    const problem = simpleProblem({ kind: "point", center: [200, 0] });
    const wrapped = solveArcsWithConditioning(problem, SPEED);
    expect(wrapped.evaluations - wrapped.arcs.evaluations).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* The level classifier, in isolation                                   */
/* ------------------------------------------------------------------ */

describe("conditioningLevel", () => {
  it("puts the thresholds on the inclusive side", () => {
    expect(conditioningLevel(CONDITION_NUMBER_THRESHOLDS.illConditioned)).toBe("ill-conditioned");
    expect(conditioningLevel(CONDITION_NUMBER_THRESHOLDS.illConditioned - 1e-9)).toBe(
      "well-conditioned",
    );
    expect(conditioningLevel(CONDITION_NUMBER_THRESHOLDS.atFold)).toBe("at-fold");
    expect(conditioningLevel(CONDITION_NUMBER_THRESHOLDS.atFold - 1e-9)).toBe("ill-conditioned");
  });

  it("treats an unmeasurable slope as being at the fold", () => {
    expect(conditioningLevel(null, null)).toBe("at-fold");
    expect(conditioningLevel(Infinity, 0)).toBe("at-fold");
  });

  it("treats a zero-elevation root with a healthy slope as well-conditioned", () => {
    // κ is undefined at θ = 0 — relative error in a zero angle has no meaning —
    // but a fold is a vanishing slope and nothing else, so a big finite slope
    // settles it. Without this the raised-launcher case would report a spike
    // exactly where the problem is at its tamest.
    expect(conditioningLevel(null, 700)).toBe("well-conditioned");
    expect(conditioningLevel(null, -700)).toBe("well-conditioned");
  });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

describe("geometricMargins", () => {
  it("spans the requested ends inclusively", () => {
    const margins = geometricMargins(100, 0.01, 5);
    expect(margins).toHaveLength(5);
    expect(margins[0]).toBeCloseTo(100, 9);
    expect(margins[4]).toBeCloseTo(0.01, 9);
  });

  it("keeps a constant ratio, so the rows are evenly spaced on a log axis", () => {
    const margins = geometricMargins(1000, 1, 4);
    expect(margins[1]! / margins[0]!).toBeCloseTo(margins[2]! / margins[1]!, 12);
  });

  it("rejects an inverted or degenerate range", () => {
    expect(() => geometricMargins(1, 10, 5)).toThrow(/must exceed/);
    expect(() => geometricMargins(0, 1, 5)).toThrow(/positive/);
    expect(() => geometricMargins(10, 1, 1)).toThrow(/integer >= 2/);
  });
});

describe("logLogSlope", () => {
  it("recovers the exponent of an exact power law", () => {
    const xs = [1, 2, 4, 8, 16];
    expect(
      logLogSlope(
        xs,
        xs.map((x) => 3 * Math.pow(x, -0.5)),
      ),
    ).toBeCloseTo(-0.5, 12);
    expect(
      logLogSlope(
        xs,
        xs.map((x) => Math.pow(x, 2)),
      ),
    ).toBeCloseTo(2, 12);
  });

  it("drops non-positive and non-finite pairs rather than clamping them", () => {
    const xs = [1, 2, 4, 8, -1, 16];
    const ys = [1, Math.SQRT1_2, 0.5, Math.SQRT1_2 / 2, 5, 0.25];
    // The -1 abscissa is dropped; the remaining five are exactly x^(-1/2).
    expect(logLogSlope(xs, ys)).toBeCloseTo(-0.5, 12);
    expect(logLogSlope([1, 2], [0, 1])).toBeNull();
  });

  it("returns null when there is nothing to fit", () => {
    expect(logLogSlope([1], [1])).toBeNull();
    expect(logLogSlope([2, 2, 2], [1, 2, 3])).toBeNull();
  });

  it("rejects mismatched lengths rather than fitting the overlap", () => {
    expect(() => logLogSlope([1, 2], [1])).toThrow(/2 x values but 1 y values/);
  });
});

describe("sweepEnvelopeConditioning", () => {
  it("rejects an empty or non-finite set of margins", () => {
    expect(() => sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, [])).toThrow(
      /at least one margin/,
    );
    expect(() => sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, [NaN])).toThrow(
      /must be finite/,
    );
  });

  it("measures the envelope once and places every row against that one number", () => {
    const sweep = sweepEnvelopeConditioning(simpleProblem(somewhere), SPEED, [10, 1, 0.1]);
    for (const sample of sweep.samples) {
      // envelopeMargin is derived from each row's own solveArcs call, so this
      // agreeing with the requested margin is a real check that the peak search
      // is repeatable and not just an identity.
      expect(sweep.maxDownrange - sample.targetDownrange).toBeCloseTo(sample.envelopeMargin, 6);
    }
  });

  it("rejects a non-positive slope step", () => {
    expect(() =>
      solveArcsWithConditioning(simpleProblem(somewhere), SPEED, { slopeStep: 0 }),
    ).toThrow(/slopeStep must be finite and positive/);
  });
});

/* ------------------------------------------------------------------ */
/* The P0.97 guard                                                      */
/* ------------------------------------------------------------------ */

describe("the zero-flight-time guard (P0.97)", () => {
  it("refuses to report a slope differenced across the launch-instant impact", () => {
    // Launching from exactly y = 0 makes the impact event true at t = 0, and
    // any flight short enough to fit inside the integrator's first step gets
    // localized there: ok: true, timeOfFlight: 0, impact at the launch point.
    // Differencing across the edge of that region gave 4.5e5 m/rad before this
    // guard, against a drag-free maximum of 2v₀²/g ≈ 734.
    const onTheDeck = simpleProblem({ kind: "point", center: [50, 0] }, 0, [0, 0]);
    const result = solveArcsWithConditioning(onTheDeck, SPEED);

    const bogus = ((2 * SPEED * SPEED) / G_STD) * 1.000001;
    if (result.low?.slope !== null && result.low?.slope !== undefined) {
      expect(Math.abs(result.low.slope)).toBeLessThan(bogus);
    }
    // Whatever it reports, it must not be a well-conditioned finite slope
    // fabricated out of a zero range.
    expect(result.low?.sensitivity ?? Infinity).toBeGreaterThan(1 / bogus);
  });

  it("is unnecessary a micron off the deck, which is why the harness launches there", () => {
    const offTheDeck = simpleProblem({ kind: "point", center: [50, 0] }, 0, [0, 1e-6]);
    const result = solveArcsWithConditioning(offTheDeck, SPEED);
    expect(result.low!.slope).not.toBeNull();
    // Back to agreeing with the closed form, at a target the ground-level
    // problem gets wrong by 39 m.
    expect(result.low!.slope! / closedFormSlope(SPEED, result.low!.theta)).toBeCloseTo(1, 5);
  });
});
