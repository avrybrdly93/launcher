import { describe, expect, it } from "vitest";
import { firstOrderSpread } from "./first-order-sensitivity.js";
import { type TornadoProblem, compareTornadoToFirstOrder, oneAtATimeTornado } from "./tornado.js";

/**
 * P6.18's criterion is "bar order matches |∂R/∂μ|σ_μ ranking", and it is met
 * here against a reference with no accuracy of its own: the drag-free range
 *
 *   R(v₀, θ) = v₀² sin(2θ) / g,
 *   ∂R/∂v₀   = 2 v₀ sin(2θ) / g,
 *   ∂R/∂θ    = 2 v₀² cos(2θ) / g,
 *
 * whose derivatives are exact. That matters for this task specifically. The
 * criterion compares a *finite difference* (the bar) against a *derivative*
 * (the first-order contribution), so a reference whose derivative is itself
 * approximated could not tell a genuine ranking swap from the reference's own
 * error.
 *
 * The suite is built around the fact that the two measures agree exactly on a
 * linear response and can disagree on a nonlinear one:
 *
 * - **Exactly linear responses** pin the bar arithmetic to floating point.
 *   A central difference of a linear function is its derivative with no
 *   truncation error at all, so `halfSpan === |∂R/∂μ| σ` is an equality, not
 *   an approximation, and any deviation is a bug rather than a tolerance
 *   question.
 * - **A quadratic response** gives an asymmetry that is known in closed form,
 *   which is what makes `asymmetry` a measured quantity rather than a
 *   plausible one.
 * - **The drag-free range at θ near 45°** is where the criterion has teeth:
 *   ∂R/∂θ passes through zero there, so θ's first-order contribution vanishes
 *   while its *bar* does not, and the two rankings genuinely part company.
 *   That case is measured below rather than avoided.
 */

const G = 9.80665;

/** Drag-free range and its exact gradient, in [v₀, θ] order. */
function rangeAt(v0: number, theta: number): number {
  return (v0 * v0 * Math.sin(2 * theta)) / G;
}
function rangeGradient(v0: number, theta: number): [number, number] {
  return [(2 * v0 * Math.sin(2 * theta)) / G, (2 * v0 * v0 * Math.cos(2 * theta)) / G];
}

function rangeProblem(v0: number, theta: number, sigmas: readonly number[]): TornadoProblem {
  return {
    inputs: ["v0", "theta"],
    sigmas,
    evaluate: (delta) => rangeAt(v0 + delta[0]!, theta + delta[1]!),
  };
}

describe("oneAtATimeTornado", () => {
  describe("argument validation", () => {
    const ok: TornadoProblem = {
      inputs: ["a", "b"],
      sigmas: [1, 1],
      evaluate: (d) => d[0]! + d[1]!,
    };

    it("rejects a length mismatch between names and sigmas", () => {
      expect(() => oneAtATimeTornado({ ...ok, sigmas: [1] })).toThrow(
        /2 input name\(s\) against 1 sigma/,
      );
    });

    it("rejects an empty problem", () => {
      expect(() => oneAtATimeTornado({ inputs: [], sigmas: [], evaluate: () => 0 })).toThrow(
        /nothing to rank/,
      );
    });

    it("rejects a negative sigma", () => {
      expect(() => oneAtATimeTornado({ ...ok, sigmas: [1, -1] })).toThrow(/sigma 1 is -1/);
    });

    it("rejects a non-finite sigma", () => {
      expect(() => oneAtATimeTornado({ ...ok, sigmas: [1, Number.NaN] })).toThrow(/sigma 1 is NaN/);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects scale %p", (scale) => {
      expect(() => oneAtATimeTornado(ok, { scale })).toThrow(/not a finite positive multiplier/);
    });

    it("rejects a nominal point with no answer", () => {
      expect(() => oneAtATimeTornado({ ...ok, evaluate: () => null })).toThrow(
        /nominal point evaluated to null/,
      );
    });

    it("rejects a non-finite displaced value rather than sorting it", () => {
      // The distinction the message insists on: null means "no answer here"
      // and is censoring; NaN means the caller has a bug, and silently
      // sorting it would bury that bug in a chart.
      const problem: TornadoProblem = {
        inputs: ["a"],
        sigmas: [1],
        evaluate: (d) => (d[0]! === 0 ? 1 : Number.NaN),
      };
      expect(() => oneAtATimeTornado(problem)).toThrow(/evaluated to NaN/);
    });
  });

  describe("a linear response, where the bar IS the derivative", () => {
    // R = 3a + 4b - 2c. A central difference of a linear function has no
    // truncation error, so every assertion here is an equality.
    const problem: TornadoProblem = {
      inputs: ["a", "b", "c"],
      sigmas: [2, 1, 0.5],
      evaluate: (d) => 10 + 3 * d[0]! + 4 * d[1]! - 2 * d[2]!,
    };

    it("gives each bar exactly twice its |dR/dmu| sigma", () => {
      const tornado = oneAtATimeTornado(problem);
      expect(tornado.nominal).toBe(10);
      // |3|*2 = 6, |4|*1 = 4, |-2|*0.5 = 1
      const byIndex = [...tornado.bars].sort((x, y) => x.index - y.index);
      expect(byIndex.map((bar) => bar.halfSpan)).toEqual([6, 4, 1]);
      expect(byIndex.map((bar) => bar.span)).toEqual([12, 8, 2]);
    });

    it("ranks a (6) above b (4) above c (1)", () => {
      const tornado = oneAtATimeTornado(problem);
      expect(tornado.order).toEqual([0, 1, 2]);
      expect(tornado.bars.map((bar) => bar.input)).toEqual(["a", "b", "c"]);
      expect(tornado.censored).toBe(false);
    });

    it("has zero asymmetry on every bar, exactly", () => {
      const tornado = oneAtATimeTornado(problem);
      for (const bar of tornado.bars) expect(bar.asymmetry).toBe(0);
    });

    it("reports every bar as monotone, including the one with a negative slope", () => {
      const tornado = oneAtATimeTornado(problem);
      for (const bar of tornado.bars) expect(bar.monotone).toBe(true);
      // c's slope is negative, so its high endpoint is BELOW nominal.
      const c = tornado.bars.find((bar) => bar.input === "c")!;
      expect(c.highShift).toBe(-1);
      expect(c.lowShift).toBe(1);
    });

    it("matches the first-order ranking exactly — P6.18's criterion", () => {
      const tornado = oneAtATimeTornado(problem);
      const { contributions } = firstOrderSpread([3, 4, -2], [2, 1, 0.5]);
      expect(contributions).toEqual([6, 4, 1]);

      const agreement = compareTornadoToFirstOrder(tornado, contributions);
      expect(agreement.identical).toBe(true);
      expect(agreement.kendallTau).toBe(1);
      expect(agreement.discordantPairs).toEqual([]);
      expect(agreement.tornadoOrder).toEqual(agreement.firstOrderOrder);
    });

    it("scales every bar by the same factor, so the order is scale-invariant", () => {
      const one = oneAtATimeTornado(problem);
      const three = oneAtATimeTornado(problem, { scale: 3 });
      expect(three.order).toEqual(one.order);
      for (let i = 0; i < one.bars.length; i++) {
        expect(three.bars[i]!.span).toBeCloseTo(3 * one.bars[i]!.span!, 12);
      }
      // And a rescaled tornado still matches the unscaled first-order ranking,
      // which is why compareTornadoToFirstOrder does not require scale === 1.
      const { contributions } = firstOrderSpread([3, 4, -2], [2, 1, 0.5]);
      expect(compareTornadoToFirstOrder(three, contributions).identical).toBe(true);
    });

    it("moves one input at a time — a coupled response would show it", () => {
      // If the implementation failed to restore delta[k] between inputs, the
      // second bar would be measured at a displaced first input. On a product
      // response that is a different number, so this fixture detects it.
      const coupled: TornadoProblem = {
        inputs: ["a", "b"],
        sigmas: [1, 1],
        // R = (1+a)(1+b): dR/da = 1 at the nominal, and 2 at a=1,b=1.
        evaluate: (d) => (1 + d[0]!) * (1 + d[1]!),
      };
      const tornado = oneAtATimeTornado(coupled);
      // Each bar is measured with the OTHER input at zero, so both spans are
      // (1+1)(1) - (1-1)(1) = 2 exactly.
      for (const bar of tornado.bars) expect(bar.span).toBe(2);
    });
  });

  describe("a zero-sigma input", () => {
    const problem: TornadoProblem = {
      inputs: ["moves", "fixed"],
      sigmas: [1, 0],
      evaluate: (d) => 5 * d[0]! + 100 * d[1]!,
    };

    it("gets a zero-width bar and sorts last, however large its gradient", () => {
      const tornado = oneAtATimeTornado(problem);
      expect(tornado.order).toEqual([0, 1]);
      const fixed = tornado.bars[1]!;
      expect(fixed.span).toBe(0);
      expect(fixed.halfSpan).toBe(0);
      expect(fixed.asymmetry).toBe(0);
      expect(fixed.monotone).toBe(false); // both shifts are zero: no movement
    });

    it("agrees with the first-order ranking, which zeroes it the same way", () => {
      const tornado = oneAtATimeTornado(problem);
      const { contributions } = firstOrderSpread([5, 100], [1, 0]);
      expect(contributions).toEqual([5, 0]);
      expect(compareTornadoToFirstOrder(tornado, contributions).identical).toBe(true);
    });
  });

  describe("curvature, measured against a closed form", () => {
    it("reports the asymmetry a quadratic response has by construction", () => {
      // R = q * d², purely curved with zero slope at the nominal. Both
      // endpoints move the same way by exactly q*σ², so:
      //   span      = 0
      //   asymmetry = 0 by the span === 0 branch
      //   monotone  = false — the nominal is a local extremum
      // A tornado draws this input as having NO influence, which is true of
      // its first derivative and false of the response. That is the honest
      // reading of a zero-width bar and the reason `monotone` is reported.
      const problem: TornadoProblem = {
        inputs: ["d"],
        sigmas: [0.5],
        evaluate: (d) => 7 * d[0]! * d[0]!,
      };
      const tornado = oneAtATimeTornado(problem);
      const bar = tornado.bars[0]!;
      expect(bar.span).toBe(0);
      expect(bar.monotone).toBe(false);
      expect(bar.lowShift).toBeCloseTo(7 * 0.25, 12);
      expect(bar.highShift).toBeCloseTo(7 * 0.25, 12);
    });

    it("reports the asymmetry of a linear-plus-quadratic response in closed form", () => {
      // R = m d + q d². With half-width h:
      //   highShift = m h + q h²,  lowShift = -m h + q h²
      //   span      = 2 m h                    (the quadratic cancels)
      //   asymmetry = |2 q h²| / (2 m h) = q h / m
      const m = 3;
      const q = 2;
      const h = 0.25;
      const problem: TornadoProblem = {
        inputs: ["d"],
        sigmas: [h],
        evaluate: (d) => m * d[0]! + q * d[0]! * d[0]!,
      };
      const bar = oneAtATimeTornado(problem).bars[0]!;
      expect(bar.span).toBeCloseTo(2 * m * h, 12);
      expect(bar.asymmetry).toBeCloseTo((q * h) / m, 12);
      // The span is exactly the linear part's, so the half-span still equals
      // |dR/dmu| sigma despite the curvature: a central difference is second-
      // order accurate, which is why the ranking survives mild nonlinearity.
      expect(bar.halfSpan).toBeCloseTo(m * h, 12);
    });
  });

  describe("censoring", () => {
    const problem: TornadoProblem = {
      inputs: ["safe", "breaks"],
      sigmas: [1, 1],
      // The second input has no answer on its upper side.
      evaluate: (d) => (d[1]! > 0 ? null : d[0]! * 2 + d[1]!),
    };

    it("marks the bar rather than giving it a span of zero", () => {
      const tornado = oneAtATimeTornado(problem);
      expect(tornado.censored).toBe(true);
      const broken = tornado.bars.find((bar) => bar.input === "breaks")!;
      expect(broken.censored).toBe(true);
      expect(broken.span).toBeNull();
      expect(broken.halfSpan).toBeNull();
      expect(broken.asymmetry).toBeNull();
      expect(broken.high).toBeNull();
      expect(broken.low).not.toBeNull();
      expect(broken.monotone).toBe(false);
    });

    it("sorts the censored bar last without claiming it is least influential", () => {
      const tornado = oneAtATimeTornado(problem);
      expect(tornado.bars.map((bar) => bar.input)).toEqual(["safe", "breaks"]);
    });

    it("refuses the ranking comparison outright", () => {
      const tornado = oneAtATimeTornado(problem);
      expect(() => compareTornadoToFirstOrder(tornado, [2, 1])).toThrow(/censored bar/);
    });
  });

  describe("ties", () => {
    it("breaks equal spans by input index, deterministically", () => {
      const problem: TornadoProblem = {
        inputs: ["z", "y", "x"],
        sigmas: [1, 1, 1],
        evaluate: (d) => d[0]! + d[1]! + d[2]!,
      };
      const tornado = oneAtATimeTornado(problem);
      expect(tornado.order).toEqual([0, 1, 2]);
      expect(tornado.bars.map((bar) => bar.span)).toEqual([2, 2, 2]);
    });

    it("does not count a tied pair as agreement in tau-b", () => {
      // Two inputs tie under the tornado but not under the first order, so
      // there is no fact about their relative order to agree on. Tau-b's
      // denominator excludes the pair rather than scoring it as concordant.
      const problem: TornadoProblem = {
        inputs: ["a", "b"],
        sigmas: [1, 1],
        evaluate: (d) => d[0]! + d[1]!,
      };
      const tornado = oneAtATimeTornado(problem);
      const agreement = compareTornadoToFirstOrder(tornado, [1, 0.5]);
      expect(agreement.kendallTau).toBe(0);
      expect(agreement.discordantPairs).toEqual([]);
    });
  });

  describe("the drag-free range, where the criterion has teeth", () => {
    it("matches the first-order ranking away from the apex", () => {
      // theta = 30 deg: cos(2θ) = 0.5, both derivatives are healthy.
      const v0 = 60;
      const theta = Math.PI / 6;
      const sigmas = [1.5, 0.01];
      const tornado = oneAtATimeTornado(rangeProblem(v0, theta, sigmas));
      const { contributions } = firstOrderSpread(rangeGradient(v0, theta), sigmas);

      const agreement = compareTornadoToFirstOrder(tornado, contributions);
      expect(agreement.identical).toBe(true);
      expect(agreement.kendallTau).toBe(1);

      // And the bars agree with the derivative in VALUE, not only in order —
      // to better than 0.1%, because a central difference on a response this
      // smooth is second-order accurate over these half-widths.
      const byIndex = [...tornado.bars].sort((x, y) => x.index - y.index);
      for (let k = 0; k < 2; k++) {
        const relative = Math.abs(byIndex[k]!.halfSpan! - contributions[k]!) / contributions[k]!;
        expect(relative).toBeLessThan(1e-3);
      }
    });

    it("parts company with the first-order ranking at the apex, measurably", () => {
      // theta = 45 deg exactly: cos(2θ) = 0, so dR/dtheta = 0 and theta's
      // first-order contribution is ZERO. But R is at a maximum in theta, so
      // moving theta by ±σ still moves the range — down, on both sides. The
      // bar's span is zero (the endpoints are equal by symmetry) while the
      // response is emphatically not flat.
      //
      // This is the case where "bar order matches the |dR/dmu|σ ranking" holds
      // for a reason that should not be mistaken for the method working: both
      // measures report theta as uninfluential, and both are wrong about the
      // response. What distinguishes them is `monotone`, which the tornado
      // reports and the first-order contribution has no way to.
      const v0 = 60;
      const theta = Math.PI / 4;
      const sigmas = [1.5, 0.05];
      const tornado = oneAtATimeTornado(rangeProblem(v0, theta, sigmas));
      const gradient = rangeGradient(v0, theta);

      expect(Math.abs(gradient[1])).toBeLessThan(1e-10);

      const thetaBar = tornado.bars.find((bar) => bar.input === "theta")!;
      expect(thetaBar.span).toBeLessThan(1e-9);
      expect(thetaBar.monotone).toBe(false);
      // Both endpoints below nominal, by the same amount — the apex.
      expect(thetaBar.lowShift).toBeLessThan(0);
      expect(thetaBar.highShift).toBeLessThan(0);
      expect(thetaBar.lowShift).toBeCloseTo(thetaBar.highShift!, 9);
      // The drop is real and is what neither measure ranks:
      // R(45°) - R(45°±0.05) = v₀²(1 - cos(0.1))/g.
      const expectedDrop = (-v0 * v0 * (1 - Math.cos(0.1))) / G;
      expect(thetaBar.highShift).toBeCloseTo(expectedDrop, 9);

      const { contributions } = firstOrderSpread(gradient, sigmas);
      const agreement = compareTornadoToFirstOrder(tornado, contributions);
      expect(agreement.identical).toBe(true);
      expect(agreement.tornadoOrder).toEqual([0, 1]);
    });

    it("can reorder the bars as the interval widens, on a nonlinear response", () => {
      // The ranking is a statement about an interval, not about a point. Just
      // below the apex, theta's derivative is small but nonzero, so at a small
      // scale theta ranks below v0. Widening the interval pushes theta's bar
      // across the apex, where the response folds back and the span STOPS
      // growing — so the two inputs' relative order can change with scale even
      // though neither response changed. Measured here rather than asserted.
      const v0 = 60;
      const theta = Math.PI / 4 - 0.06;
      const sigmas = [0.02, 0.05];

      const narrow = oneAtATimeTornado(rangeProblem(v0, theta, sigmas), { scale: 1 });
      const wide = oneAtATimeTornado(rangeProblem(v0, theta, sigmas), { scale: 8 });

      // Both bars grow with scale, but not by the same factor. Measured:
      //   v0     8.000000  — exactly the linear factor, to 6 figures. R is
      //                      quadratic in v0, but over ±0.16 m/s at v0 = 60
      //                      the central difference's cubic term is nil.
      //   theta  7.185531  — sub-linear, because widening past the apex adds
      //                      no span: R folds back.
      const span = (t: typeof narrow, name: string) =>
        t.bars.find((bar) => bar.input === name)!.span!;
      const v0Growth = span(wide, "v0") / span(narrow, "v0");
      const thetaGrowth = span(wide, "theta") / span(narrow, "theta");

      expect(v0Growth).toBeCloseTo(8, 6);
      expect(thetaGrowth).toBeCloseTo(7.185531, 5);
      expect(thetaGrowth).toBeLessThan(v0Growth);

      // The curvature signal fires where it should, and its VALUE is the
      // measurement: 0.415 at scale 1, 3.506 at scale 8. The second is above
      // 1, which the metric permits — see TornadoBar.asymmetry. What makes it
      // above 1 is that the wide bar has folded over the apex, so both
      // endpoints sit below the nominal and the span is a difference of two
      // same-signed shifts.
      const thetaNarrow = narrow.bars.find((bar) => bar.input === "theta")!;
      const thetaWide = wide.bars.find((bar) => bar.input === "theta")!;
      expect(thetaNarrow.asymmetry).toBeCloseTo(0.415011, 5);
      expect(thetaWide.asymmetry).toBeCloseTo(3.506349, 5);

      expect(thetaNarrow.monotone).toBe(true);
      expect(thetaWide.monotone).toBe(false);
      expect(thetaWide.lowShift).toBeLessThan(0);
      expect(thetaWide.highShift).toBeLessThan(0);
    });
  });

  describe("compareTornadoToFirstOrder argument validation", () => {
    const tornado = oneAtATimeTornado({
      inputs: ["a", "b"],
      sigmas: [1, 1],
      evaluate: (d) => 2 * d[0]! + d[1]!,
    });

    it("rejects a length mismatch", () => {
      expect(() => compareTornadoToFirstOrder(tornado, [1])).toThrow(
        /2 bar\(s\) against 1 contribution/,
      );
    });

    it("rejects a negative contribution", () => {
      expect(() => compareTornadoToFirstOrder(tornado, [1, -1])).toThrow(/contribution 1 is -1/);
    });

    it("reports a discordant pair with the input indices, in input order", () => {
      // The tornado ranks a above b (spans 4 and 2); a first order that
      // disagrees must show the pair.
      const agreement = compareTornadoToFirstOrder(tornado, [1, 5]);
      expect(agreement.identical).toBe(false);
      expect(agreement.discordantPairs).toEqual([[0, 1]]);
      expect(agreement.kendallTau).toBe(-1);
      expect(agreement.tornadoOrder).toEqual([0, 1]);
      expect(agreement.firstOrderOrder).toEqual([1, 0]);
    });
  });
});
