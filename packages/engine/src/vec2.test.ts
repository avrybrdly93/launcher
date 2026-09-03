import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { norm, normSq } from "./vec2.js";

/**
 * The domain {@link norm}'s doc comment actually claims, and the only one its
 * production callers reach: a relative air velocity in m/s. 2000 m/s is well
 * past any muzzle velocity this project models and is deliberately generous —
 * the point is that the bound holds with room to spare, not that it is tight.
 */
const TRAJECTORY_SCALE = 2000;

/**
 * P0.120 replaced `Math.hypot` with `sqrt(x*x + y*y)` in {@link norm} for a
 * measured 30.4x, and the two are not bit-identical. These cases pin the
 * accuracy claim the doc comment makes, so that the trade is a stated,
 * enforced contract rather than a comment someone has to trust — and so that
 * a future session cannot quietly widen it.
 *
 * `Math.hypot` is the reference here precisely because it is the more accurate
 * of the two: it is what the naive form is being held against, not the other
 * way round.
 */
describe("vec2.norm against Math.hypot (P0.120)", () => {
  /**
   * 2 ulp, against a measured maximum of about 1.4 ulp. A relative bound
   * rather than an absolute one because the quantity spans several decades,
   * and `Number.EPSILON` rather than a hand-picked decimal so that the bound
   * reads as "a couple of rounding steps" instead of a magic constant.
   */
  const RELATIVE_BOUND = 2 * Number.EPSILON;

  /**
   * The lower end of the documented domain. `fc.double` bounded to
   * ±{@link TRAJECTORY_SCALE} still reaches subnormals — 5e-324 is inside
   * [-2000, 2000] — and there `x*x` flushes to zero while `Math.hypot`'s
   * scaling survives, so the naive form really does return 0 against a
   * nonzero reference. That is not a defect being excused: it is the
   * underflow limit the doc comment states, it is asserted directly in the
   * out-of-domain case below, and a velocity component of 1e-300 m/s is not
   * a thing this model produces. 1e-150 sits comfortably above the ~1.5e-162
   * threshold where the intermediate actually degrades.
   */
  const SMALLEST_MEANINGFUL_COMPONENT = 1e-150;

  it("agrees with Math.hypot to within 2 ulp across the documented domain", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -TRAJECTORY_SCALE, max: TRAJECTORY_SCALE, noNaN: true }),
        fc.double({ min: -TRAJECTORY_SCALE, max: TRAJECTORY_SCALE, noNaN: true }),
        (x, y) => {
          fc.pre(x === 0 || Math.abs(x) >= SMALLEST_MEANINGFUL_COMPONENT);
          fc.pre(y === 0 || Math.abs(y) >= SMALLEST_MEANINGFUL_COMPONENT);
          const reference = Math.hypot(x, y);
          const actual = norm([x, y]);
          // The zero vector is exact in both forms; guarding it keeps the
          // relative comparison from dividing by zero rather than excusing it.
          if (reference === 0) {
            expect(actual).toBe(0);
            return;
          }
          expect(Math.abs(actual - reference) / reference).toBeLessThanOrEqual(RELATIVE_BOUND);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("is exact on the cases where an exact answer exists", () => {
    expect(norm([0, 0])).toBe(0);
    expect(norm([3, 4])).toBe(5);
    expect(norm([-3, -4])).toBe(5);
    expect(norm([5, 0])).toBe(5);
    expect(norm([0, -7])).toBe(7);
  });

  it("stays consistent with normSq, which shares its intermediates", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -TRAJECTORY_SCALE, max: TRAJECTORY_SCALE, noNaN: true }),
        fc.double({ min: -TRAJECTORY_SCALE, max: TRAJECTORY_SCALE, noNaN: true }),
        (x, y) => {
          expect(norm([x, y])).toBe(Math.sqrt(normSq([x, y])));
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * The documented limit of the trade, asserted rather than left implied.
   * These magnitudes are ~150 orders of magnitude outside anything a
   * projectile reaches, and the test exists so that the *reason* the naive
   * form is acceptable stays visible: it is a domain argument, not a claim
   * that the two forms are interchangeable everywhere.
   */
  it("does lose to Math.hypot outside its documented domain, which is why the domain is documented", () => {
    // Intermediate x*x overflows to Infinity here; Math.hypot's scaling does not.
    const huge = 1e200;
    expect(norm([huge, huge])).toBe(Number.POSITIVE_INFINITY);
    expect(Math.hypot(huge, huge)).toBeCloseTo(huge * Math.SQRT2, -190);

    // Intermediate x*x flushes to zero here; Math.hypot's scaling does not.
    const tiny = 1e-200;
    expect(norm([tiny, tiny])).toBe(0);
    expect(Math.hypot(tiny, tiny)).toBeGreaterThan(0);
  });
});
