import { describe, expect, it } from "vitest";
import {
  DEFAULT_X_TOL_ABSOLUTE,
  type Minimize1DOptions,
  type Minimize1DResult,
  type ScalarObjective,
  SQRT_EPSILON,
  brentMinimize,
  goldenSectionMinimize,
} from "./brent-minimize.js";

/**
 * P5.13's criterion is "unimodal test functions to 1e-10", and taking it
 * literally over both outputs would be asserting something false. `1e-10` on
 * the objective *value* is comfortably met by both methods on every function
 * below. `1e-10` on the *location* is met on some of them and is unreachable in
 * double precision on others — not because of anything these implementations do
 * but because the information is not in the function values. So the value
 * criterion is asserted everywhere, the location criterion is asserted where it
 * is attainable, and the boundary between the two is itself asserted, against a
 * closed-form prediction, rather than being asserted around.
 *
 * **The prediction.** Near a smooth interior minimum
 * `f(x) − f(x*) ≈ ½f''(x*)(x − x*)²`, while the rounding error in evaluating
 * `f` is `O(ε|f(x*)|)`. A method that only compares values cannot distinguish
 * two points once the former falls under the latter, so its error floor is
 *
 *     δ_floor ≈ √(2 ε |f(x*)| / f''(x*)).
 *
 * The term that surprises people is `|f(x*)|`: the floor is set by the
 * magnitude of the value being cancelled against, *not* by `|x*|`. A minimum
 * whose value is zero has no floor. The "precision floor" block below checks
 * this on five functions spanning three orders of magnitude of predicted floor,
 * including two with `f(x*) = 0` that are located exactly.
 *
 * **Every expectation is a closed form**, never a recorded output of this code:
 * `x·ln x` minimizes at `1/e` with value `−1/e`, `eˣ − 2x` at `ln 2` with value
 * `2 − 2ln 2`, and so on. Two tests below deliberately assert an *inequality
 * between the two methods* (evaluation count, achieved accuracy) rather than
 * absolute numbers, because those comparisons are the actual claims the module
 * makes about when to reach for which.
 */

/** A unimodal test problem with a minimizer and minimum value known in closed form. */
interface TestFunction {
  readonly name: string;
  readonly f: ScalarObjective;
  /** A bracket containing the minimum in its interior. */
  readonly bracket: readonly [number, number];
  /** Exact minimizer. */
  readonly xStar: number;
  /** Exact minimum value. */
  readonly fStar: number;
  /** `f''(x*)`, exact — the curvature the floor formula needs. */
  readonly curvature: number;
}

/**
 * Five smooth unimodal functions, chosen so that `|f(x*)|` — the quantity the
 * floor scales with — varies from `1` down to exactly `0`, which is what makes
 * the floor formula falsifiable rather than merely consistent.
 */
const SMOOTH: readonly TestFunction[] = [
  {
    // f'' = 1/x, so f''(1/e) = e.
    name: "x·ln x",
    f: (x) => x * Math.log(x),
    bracket: [0.05, 2],
    xStar: 1 / Math.E,
    fStar: -1 / Math.E,
    curvature: Math.E,
  },
  {
    name: "−cos x",
    f: (x) => -Math.cos(x),
    bracket: [-1, 2],
    xStar: 0,
    fStar: -1,
    curvature: 1,
  },
  {
    // f'' = eˣ, so f''(ln 2) = 2.
    name: "eˣ − 2x",
    f: (x) => Math.exp(x) - 2 * x,
    bracket: [-1, 2],
    xStar: Math.LN2,
    fStar: 2 - 2 * Math.LN2,
    curvature: 2,
  },
  {
    name: "cosh(x − 0.7)",
    f: (x) => Math.cosh(x - 0.7),
    bracket: [-2, 3],
    xStar: 0.7,
    fStar: 1,
    curvature: 1,
  },
  {
    // f(x*) = 0 exactly, and f'' = 0 too: a quartic minimum, flatter than
    // quadratic, which the floor formula nonetheless predicts correctly
    // because its numerator vanishes.
    name: "(x − 1.3)⁴",
    f: (x) => (x - 1.3) ** 4,
    bracket: [0, 3],
    xStar: 1.3,
    fStar: 0,
    curvature: 0,
  },
];

/**
 * Unimodal but not differentiable at the minimum. `f` changes by `O(δ)` rather
 * than `O(δ²)`, so comparisons stay informative all the way down and the
 * location is recoverable to full precision — the opposite regime to `−cos x`.
 */
const KINKED: readonly TestFunction[] = [
  {
    name: "|x − 0.3|",
    f: (x) => Math.abs(x - 0.3),
    bracket: [-1, 2],
    xStar: 0.3,
    fStar: 0,
    curvature: Number.NaN,
  },
  {
    name: "max(0.4 − x, 2(x − 0.4))",
    f: (x) => Math.max(0.4 - x, 2 * (x - 0.4)),
    bracket: [-1, 3],
    xStar: 0.4,
    fStar: 0,
    curvature: Number.NaN,
  },
];

const METHODS: ReadonlyArray<
  readonly [
    string,
    (f: ScalarObjective, a: number, b: number, o?: Minimize1DOptions) => Minimize1DResult,
  ]
> = [
  ["goldenSectionMinimize", goldenSectionMinimize],
  ["brentMinimize", brentMinimize],
];

/** The tightest tolerance worth asking for; below this only rounding remains. */
const TIGHT: Minimize1DOptions = { xTolRelative: 0, xTolAbsolute: 1e-15 };

describe("the P5.13 criterion, on the objective value", () => {
  for (const [methodName, minimize] of METHODS) {
    for (const t of SMOOTH) {
      it(`${methodName} minimizes ${t.name} to 1e-10 in value at the default tolerance`, () => {
        const result = minimize(t.f, t.bracket[0], t.bracket[1]);

        expect(result.status).toBe("converged");
        expect(result.converged).toBe(true);
        expect(Math.abs(result.fx - t.fStar)).toBeLessThanOrEqual(1e-10);

        // `fx` is an evaluated value, not an interpolated one, and `x` always
        // lies inside the interval the search reports.
        expect(result.fx).toBe(t.f(result.x));
        expect(result.x).toBeGreaterThanOrEqual(result.bracket[0]);
        expect(result.x).toBeLessThanOrEqual(result.bracket[1]);
      });
    }

    for (const t of KINKED) {
      it(`${methodName} minimizes ${t.name} to 1e-10 in value, but only once told to`, () => {
        // The exact dual of the smooth case, and the reason the default
        // tolerance is not enough here. At a kink `f − f* = O(δ)` rather than
        // `O(δ²)`, so a location good to the default `√ε·|x*| ≈ 4.5e-9` yields
        // a *value* good only to about the same 4.5e-9 — a hundredfold short of
        // 1e-10, where a smooth minimum would have delivered 2e-17. The
        // compensation is that a kink has no location floor, so simply asking
        // for a tighter tolerance works, which at a smooth minimum it would not.
        const lazy = minimize(t.f, t.bracket[0], t.bracket[1]);
        expect(Math.abs(lazy.fx - t.fStar)).toBeGreaterThan(1e-11);

        const result = minimize(t.f, t.bracket[0], t.bracket[1], TIGHT);

        expect(result.status).toBe("converged");
        expect(Math.abs(result.fx - t.fStar)).toBeLessThanOrEqual(1e-10);
        expect(result.fx).toBe(t.f(result.x));
        expect(result.x).toBeGreaterThanOrEqual(result.bracket[0]);
        expect(result.x).toBeLessThanOrEqual(result.bracket[1]);
      });
    }
  }
});

describe("the P5.13 criterion, on the location, where it is attainable", () => {
  for (const [methodName, minimize] of METHODS) {
    for (const t of KINKED) {
      it(`${methodName} locates ${t.name} to 1e-10`, () => {
        const result = minimize(t.f, t.bracket[0], t.bracket[1], TIGHT);

        expect(result.converged).toBe(true);
        expect(Math.abs(result.x - t.xStar)).toBeLessThanOrEqual(1e-10);
      });
    }

    it(`${methodName} locates the zero-valued quartic (x − 1.3)⁴ to 1e-10`, () => {
      // Smooth, but `f(x*) = 0`, so the floor's numerator vanishes and the
      // location is recoverable despite the minimum being quartically flat.
      const quartic = SMOOTH[4]!;
      const result = minimize(quartic.f, quartic.bracket[0], quartic.bracket[1], TIGHT);

      expect(result.converged).toBe(true);
      expect(Math.abs(result.x - quartic.xStar)).toBeLessThanOrEqual(1e-10);
    });
  }
});

describe("the precision floor that makes the location criterion unattainable elsewhere", () => {
  /** `√(2 ε |f(x*)| / f''(x*))`, the comparison-only error floor. */
  const predictedFloor = (t: TestFunction): number =>
    Math.sqrt((2 * Number.EPSILON * Math.abs(t.fStar)) / t.curvature);

  for (const t of SMOOTH.filter((s) => s.curvature > 0 && s.fStar !== 0)) {
    it(`golden section on ${t.name} stalls at the predicted floor, and tightening does not help`, () => {
      const floor = predictedFloor(t);

      const loose = goldenSectionMinimize(t.f, t.bracket[0], t.bracket[1], {
        xTolRelative: 0,
        xTolAbsolute: 1e-12,
      });
      const tighter = goldenSectionMinimize(t.f, t.bracket[0], t.bracket[1], TIGHT);

      // Both stop within a small factor of the predicted floor: close enough
      // that the prediction is doing real work (it spans 5.9e-9 to 2.1e-8
      // across these functions), loose enough not to pin an exact rounding
      // pattern. The lower bound is the substantive half — it asserts the
      // method genuinely cannot get closer.
      for (const result of [loose, tighter]) {
        const error = Math.abs(result.x - t.xStar);
        expect(error).toBeLessThan(4 * floor);
        expect(error).toBeGreaterThan(floor / 8);
      }

      // Asking for 1000x tighter buys nothing: the extra iterations contract an
      // interval over values that are already indistinguishable.
      expect(Math.abs(tighter.x - t.xStar)).toBeGreaterThan(floor / 8);
      expect(tighter.evaluations).toBeGreaterThan(loose.evaluations);

      // And the 1e-10 location criterion is out of reach here — not a defect,
      // which is the whole point of asserting it.
      expect(Math.abs(tighter.x - t.xStar)).toBeGreaterThan(1e-10);
    });
  }

  it("the floor scales with the minimum value, not with |x*|", () => {
    // `−cos x` has `x* = 0` and `cosh(x − 0.7)` has `x* = 0.7`; a floor
    // proportional to `|x*|` would predict the first is located exactly and
    // would be wrong. Both have `|f(x*)| = 1` and `f'' = 1`, so the correct
    // formula predicts the same floor for both, and the measurements agree.
    const atZero = goldenSectionMinimize(SMOOTH[1]!.f, -1, 2, TIGHT);
    const awayFromZero = goldenSectionMinimize(SMOOTH[3]!.f, -2, 3, TIGHT);

    const errorAtZero = Math.abs(atZero.x - 0);
    const errorAwayFromZero = Math.abs(awayFromZero.x - 0.7);

    expect(errorAtZero).toBeGreaterThan(1e-9);
    expect(errorAwayFromZero).toBeGreaterThan(1e-9);
    expect(errorAtZero / errorAwayFromZero).toBeGreaterThan(0.1);
    expect(errorAtZero / errorAwayFromZero).toBeLessThan(10);
  });

  it("parabolic interpolation beats the floor that stops golden section", () => {
    // The module's stated reason to prefer brentMinimize on smooth problems.
    // Interpolation reads three points that can sit outside the flat region, so
    // the vertex it computes is better than any comparison between points near
    // the minimum.
    for (const t of SMOOTH.filter((s) => s.curvature > 0 && s.fStar !== 0)) {
      const floor = predictedFloor(t);
      const brent = brentMinimize(t.f, t.bracket[0], t.bracket[1], TIGHT);
      const golden = goldenSectionMinimize(t.f, t.bracket[0], t.bracket[1], TIGHT);

      expect(Math.abs(brent.x - t.xStar)).toBeLessThan(floor);
      expect(Math.abs(brent.x - t.xStar)).toBeLessThan(Math.abs(golden.x - t.xStar));
    }
  });

  it("an exact quadratic is solved to the last bit from any three points", () => {
    // The limiting case of the previous test: a parabola fitted to an exact
    // parabola is exact, so Brent's first interpolated step is the answer and
    // no floor applies at all -- with `f(x*) = 3`, a comparison-based method
    // would stall around 2.6e-8.
    const result = brentMinimize((x) => (x - 2) ** 2 + 3, 0, 5);

    expect(result.x).toBe(2);
    expect(result.fx).toBe(3);
    expect(result.evaluations).toBeLessThan(10);
  });
});

describe("cost", () => {
  it("brentMinimize needs far fewer evaluations than golden section on smooth objectives", () => {
    for (const t of SMOOTH) {
      const brent = brentMinimize(t.f, t.bracket[0], t.bracket[1]);
      const golden = goldenSectionMinimize(t.f, t.bracket[0], t.bracket[1]);

      expect(brent.evaluations).toBeLessThan(golden.evaluations / 2);
    }
  });

  it("golden section contracts by the golden ratio every iteration, whatever f does", () => {
    // The predictability that makes it worth keeping: the final interval width
    // is determined by the iteration count alone, not by the function. Two
    // completely different objectives, run to the same iteration cap, must
    // produce the same width from the same starting bracket.
    const capped: Minimize1DOptions = { maxIterations: 12, xTolRelative: 0, xTolAbsolute: 0 };
    const smooth = goldenSectionMinimize((x) => (x - 2) ** 2, 0, 5, capped);
    const jagged = goldenSectionMinimize(
      (x) => Math.abs(Math.sin(9 * x)) + (x - 2) ** 2,
      0,
      5,
      capped,
    );

    const widthOf = (r: Minimize1DResult): number => r.bracket[1] - r.bracket[0];
    expect(widthOf(smooth)).toBeCloseTo(widthOf(jagged), 15);

    // 5 · 0.618¹² ≈ 0.0165, the closed-form prediction.
    expect(widthOf(smooth)).toBeCloseTo(5 * ((Math.sqrt(5) - 1) / 2) ** 12, 12);
  });
});

describe("contract", () => {
  for (const [methodName, minimize] of METHODS) {
    it(`${methodName} rejects a bracket that is not ordered or not finite`, () => {
      expect(() => minimize((x) => x, 2, 1)).toThrow(/must satisfy a < b/);
      expect(() => minimize((x) => x, 1, 1)).toThrow(/must satisfy a < b/);
      expect(() => minimize((x) => x, 0, Number.POSITIVE_INFINITY)).toThrow(/must be finite/);
      expect(() => minimize((x) => x, Number.NaN, 1)).toThrow(/must be finite/);
    });

    it(`${methodName} treats a non-finite value as inadmissible and contracts away from it`, () => {
      // The right half of the interval is rejected by the objective; the
      // minimum in the admissible part is still found.
      const result = minimize((x) => (x > 1.5 ? Number.NaN : (x - 1) ** 2), 0, 3);

      expect(result.converged).toBe(true);
      expect(result.x).toBeCloseTo(1, 7);
      expect(Number.isFinite(result.fx)).toBe(true);
    });

    it(`${methodName} reports evaluation-failed when nothing is admissible`, () => {
      const result = minimize(() => Number.NaN, 0, 3);

      expect(result.status).toBe("evaluation-failed");
      expect(result.converged).toBe(false);
      expect(result.fx).toBe(Number.POSITIVE_INFINITY);
    });

    it(`${methodName} reports max-iterations rather than throwing`, () => {
      const result = minimize((x) => (x - 2) ** 2, 0, 5, {
        maxIterations: 3,
        xTolRelative: 0,
        xTolAbsolute: 0,
      });

      expect(result.status).toBe("max-iterations");
      expect(result.converged).toBe(false);
      expect(result.iterations).toBe(3);
      // The bracket is still honest about the remaining uncertainty.
      expect(result.bracket[1] - result.bracket[0]).toBeGreaterThan(1e-3);
      expect(result.x).toBeGreaterThanOrEqual(result.bracket[0]);
      expect(result.x).toBeLessThanOrEqual(result.bracket[1]);
    });

    it(`${methodName} counts every evaluation it makes`, () => {
      let actual = 0;
      const result = minimize(
        (x) => {
          actual += 1;
          return x * Math.log(x);
        },
        0.05,
        2,
      );

      expect(result.evaluations).toBe(actual);
    });

    it(`${methodName} is deterministic`, () => {
      const run = (): Minimize1DResult => minimize((x) => Math.cosh(x - 0.7), -2, 3);

      expect(run()).toEqual(run());
    });

    it(`${methodName} handles a minimum sitting at a bracket endpoint by converging to it`, () => {
      // Not the contract either function advertises -- both assume an interior
      // minimum -- but a monotone objective must still terminate cleanly rather
      // than spin, since callers establish brackets from problem structure and
      // can get this slightly wrong.
      const result = minimize((x) => x, 0, 1);

      expect(result.converged).toBe(true);
      expect(result.x).toBeLessThan(1e-6);
    });
  }

  it("the default relative tolerance is the smooth-minimum floor", () => {
    expect(SQRT_EPSILON).toBeCloseTo(1.4901161193847656e-8, 20);
    expect(DEFAULT_X_TOL_ABSOLUTE).toBeLessThan(SQRT_EPSILON);
  });

  it("both methods agree on the minimizer within their achievable accuracy", () => {
    // Run at the tight tolerance so the kinked cases are compared where both
    // methods have actually converged in value; at the default they stop at
    // their own x-tolerance and differ by O(√ε) in value, as the criterion
    // tests above establish.
    for (const t of [...SMOOTH, ...KINKED]) {
      const brent = brentMinimize(t.f, t.bracket[0], t.bracket[1], TIGHT);
      const golden = goldenSectionMinimize(t.f, t.bracket[0], t.bracket[1], TIGHT);

      expect(Math.abs(brent.x - golden.x)).toBeLessThan(1e-6);
      expect(Math.abs(brent.fx - golden.fx)).toBeLessThanOrEqual(1e-10);
    }
  });
});
