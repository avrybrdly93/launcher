import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ISA, SUTHERLAND, sutherlandViscosity } from "./units.js";

/**
 * The temperature range {@link sutherlandViscosity}'s callers actually reach.
 * The ISA troposphere runs from 288.15 K at sea level to 216.65 K at 11 km,
 * and `LayeredAtmosphere`/`IsothermalAtmosphere` let a scenario pick its own
 * sea-level temperature, so the bracket is deliberately wider than the ISA
 * profile rather than tight to it. Nothing in this project models air below
 * 150 K or above 350 K.
 */
const MIN_TEMPERATURE_K = 150;
const MAX_TEMPERATURE_K = 350;

/**
 * P0.121 replaced `Math.pow(r, 1.5)` with `r * Math.sqrt(r)` in
 * {@link sutherlandViscosity} for a measured 5.85x, and the two are not
 * bit-identical. These cases pin the accuracy claim the doc comment makes, so
 * the trade is an enforced contract rather than a comment someone has to
 * trust — and so a future session cannot quietly widen it.
 *
 * This mirrors `vec2.test.ts` deliberately: same shape of trade, same shape of
 * test. As there, the `Math.pow` form is the reference not because it is
 * exact — for a fractional exponent it is itself only correctly rounded to
 * within about an ulp — but because it is the form being replaced, and the
 * question is whether the replacement moves the answer by more than rounding.
 */
describe("sutherlandViscosity against the Math.pow form (P0.121)", () => {
  /**
   * The reference: eq. 3.12 written exactly as it stood before P0.121.
   * Inlined rather than imported so that the test still compares two
   * implementations after the production one changes again.
   */
  const viaPow = (temperatureK: number): number =>
    SUTHERLAND.etaRef *
    Math.pow(temperatureK / SUTHERLAND.Tref, 1.5) *
    ((SUTHERLAND.Tref + SUTHERLAND.S) / (temperatureK + SUTHERLAND.S));

  /**
   * 4 ulp, against a measured maximum of **exactly 2.0000x `Number.EPSILON`**
   * (4.440826e-16, at T = 236.05 K) over a 4e6-point sweep of this range.
   * The 2x margin is deliberate: a bound set at the measured maximum has no
   * headroom at all, and this assertion would then be one unlucky rounding
   * away from failing on an input nobody chose. Relative rather than absolute
   * because eta spans decades, and expressed in `Number.EPSILON` so the bound
   * reads as "a few rounding steps" instead of a magic decimal.
   */
  const RELATIVE_BOUND = 4 * Number.EPSILON;

  it("agrees with the Math.pow form to within 4 ulp across the modelled range", () => {
    fc.assert(
      fc.property(
        fc.double({ min: MIN_TEMPERATURE_K, max: MAX_TEMPERATURE_K, noNaN: true }),
        (temperatureK) => {
          const reference = viaPow(temperatureK);
          const actual = sutherlandViscosity(temperatureK);
          expect(Math.abs(actual - reference) / reference).toBeLessThanOrEqual(RELATIVE_BOUND);
        },
      ),
      { numRuns: 2000 },
    );
  });

  /**
   * The one input where both forms are exact, and it is the one the rest of
   * the engine leans on: `environment.test.ts` asserts `out.eta` is `toBe`
   * (not `toBeCloseTo`) `sutherlandViscosity(ISA.T0)` in three places, and
   * `ISA.T0` is `SUTHERLAND.Tref`. At r = 1 both `Math.pow(1, 1.5)` and
   * `1 * Math.sqrt(1)` are exactly 1, so this change cannot move the
   * sea-level reference viscosity at all.
   */
  it("is unchanged at the reference temperature, where both forms are exact", () => {
    expect(SUTHERLAND.Tref).toBe(ISA.T0);
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(viaPow(SUTHERLAND.Tref));
    expect(sutherlandViscosity(SUTHERLAND.Tref)).toBe(SUTHERLAND.etaRef);
  });

  /**
   * Monotonicity is the physical content of eq. 3.12 over this range — hotter
   * air is more viscous — and it is the property a wrong exponent breaks most
   * visibly. Asserted over the range rather than at a point so that it grades
   * the formula and not one lucky sample.
   */
  it("increases with temperature across the modelled range", () => {
    let previous = sutherlandViscosity(MIN_TEMPERATURE_K);
    for (
      let temperatureK = MIN_TEMPERATURE_K + 1;
      temperatureK <= MAX_TEMPERATURE_K;
      temperatureK++
    ) {
      const eta = sutherlandViscosity(temperatureK);
      expect(eta).toBeGreaterThan(previous);
      previous = eta;
    }
  });

  /**
   * The other half of the contract, and the reason the bound above is a
   * bound rather than `toBe`: the two forms really are different functions.
   * Without this case, an implementation that simply went back to `Math.pow`
   * would satisfy every other assertion here, and the file would stop
   * grading the thing it was written for.
   *
   * This temperature is the sweep's argmax — the two forms differ by exactly
   * 2.0000x `Number.EPSILON` at it. They agree bit-for-bit at 79% of the
   * range, so a sample chosen for readability would likely have proved
   * nothing.
   */
  it("is not bit-identical to the Math.pow form, which is what makes this a trade", () => {
    const worstCase = 236.04725000000002;
    expect(sutherlandViscosity(worstCase)).not.toBe(viaPow(worstCase));
    const relative =
      Math.abs(sutherlandViscosity(worstCase) - viaPow(worstCase)) / viaPow(worstCase);
    expect(relative / Number.EPSILON).toBeCloseTo(2, 3);
  });

  /**
   * The trade's actual limit, asserted rather than left implied. `Math.pow`
   * of a negative base with a fractional exponent is NaN, and so is
   * `Math.sqrt` of a negative — the two agree, and both refuse. This is the
   * counterpart of `vec2.test.ts`'s out-of-domain case: it keeps visible that
   * the argument for the cheap form is a domain argument.
   */
  it("returns NaN below absolute zero, exactly as the Math.pow form does", () => {
    expect(sutherlandViscosity(-1)).toBeNaN();
    expect(viaPow(-1)).toBeNaN();
    expect(sutherlandViscosity(0)).toBe(0);
    expect(viaPow(0)).toBe(0);
  });
});
