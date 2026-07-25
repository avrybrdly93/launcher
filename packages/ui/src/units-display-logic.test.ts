import { describe, expect, it } from "vitest";
import { displayUnitFor, toDisplayValue, toSIValue } from "./units-display-logic.js";

describe("units-display-logic: SI mode is always a passthrough", () => {
  it("value, unit, and delta are unchanged regardless of siUnit", () => {
    for (const unit of ["m", "m/s", "kg", "deg", "rad/s", undefined]) {
      expect(toDisplayValue(42, unit, "SI")).toBe(42);
      expect(toSIValue(42, unit, "SI")).toBe(42);
      expect(displayUnitFor(unit, "SI")).toBe(unit);
    }
  });
});

describe("units-display-logic: imperial mode converts known units", () => {
  it("length (m -> ft)", () => {
    expect(displayUnitFor("m", "imperial")).toBe("ft");
    expect(toDisplayValue(1, "m", "imperial")).toBeCloseTo(3.280839895, 9);
  });

  it("speed (m/s -> mph)", () => {
    expect(displayUnitFor("m/s", "imperial")).toBe("mph");
    expect(toDisplayValue(1, "m/s", "imperial")).toBeCloseTo(2.2369362920544, 9);
  });

  it("mass (kg -> lb)", () => {
    expect(displayUnitFor("kg", "imperial")).toBe("lb");
    expect(toDisplayValue(1, "kg", "imperial")).toBeCloseTo(2.2046226218487757, 9);
  });

  it("round-trips through toSIValue for every known unit", () => {
    for (const [unit, value] of [
      ["m", 12.5],
      ["m/s", 33.4],
      ["kg", 0.145],
    ] as const) {
      const display = toDisplayValue(value, unit, "imperial");
      expect(toSIValue(display, unit, "imperial")).toBeCloseTo(value, 9);
    }
  });

  it("an unknown unit (no imperial equivalent) passes through unconverted", () => {
    for (const unit of ["deg", "rad/s", "kg/m^3", "Pa", "K", "m^2/s"]) {
      expect(displayUnitFor(unit, "imperial")).toBe(unit);
      expect(toDisplayValue(7, unit, "imperial")).toBe(7);
      expect(toSIValue(7, unit, "imperial")).toBe(7);
    }
  });

  it("an undefined unit passes through unconverted", () => {
    expect(displayUnitFor(undefined, "imperial")).toBeUndefined();
    expect(toDisplayValue(7, undefined, "imperial")).toBe(7);
    expect(toSIValue(7, undefined, "imperial")).toBe(7);
  });
});
