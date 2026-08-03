import { describe, expect, it } from "vitest";
import { degToRad } from "@ballista/engine";
import { simulateLongRangeShot } from "./long-range-coriolis-preset.js";

/**
 * P4.28 (blueprint §8.2): "Long-range ballistic preset (Coriolis-visible)",
 * validation criterion "deflection sign flips across hemispheres". See
 * `long-range-coriolis-preset.ts`'s module doc for the physics: a long-range
 * shot's sustained downrange velocity `v_x` drives a `sin(phi)`-proportional
 * lateral Coriolis term that is odd in latitude (unlike P4.27's
 * `cos(phi)`-driven vertical-drop term, which is even and does NOT flip
 * sign), so mirroring the launch latitude across the equator must mirror
 * the sign of the final lateral (z) deflection.
 */
describe("Long-range ballistic preset (P4.28, blueprint §8.2)", () => {
  const NORTH_45 = degToRad(45);
  const SOUTH_45 = degToRad(-45);

  it("deflects to the right of the line of fire (+z, East) in the Northern Hemisphere", () => {
    const report = simulateLongRangeShot(NORTH_45);
    expect(report.status).toBe("ok");
    expect(report.yFinal[2]).toBeGreaterThan(0);
  });

  it("deflects to the left of the line of fire (-z, West) in the Southern Hemisphere", () => {
    const report = simulateLongRangeShot(SOUTH_45);
    expect(report.status).toBe("ok");
    expect(report.yFinal[2]).toBeLessThan(0);
  });

  it("deflection sign flips across hemispheres at the mirrored latitude (validation criterion)", () => {
    const north = simulateLongRangeShot(NORTH_45);
    const south = simulateLongRangeShot(SOUTH_45);
    expect(Math.sign(north.yFinal[2]!)).toBe(-Math.sign(south.yFinal[2]!));
  });

  it("is genuinely Coriolis-visible: deflection magnitude is well above numerical noise (>1 m)", () => {
    const north = simulateLongRangeShot(NORTH_45);
    const south = simulateLongRangeShot(SOUTH_45);
    expect(Math.abs(north.yFinal[2]!)).toBeGreaterThan(1);
    expect(Math.abs(south.yFinal[2]!)).toBeGreaterThan(1);
  });

  it("with omega=0, the Coriolis contribution vanishes and lateral deflection is exactly zero", () => {
    const report = simulateLongRangeShot(NORTH_45, 0);
    expect(report.status).toBe("ok");
    expect(report.yFinal[2]).toBe(0);
  });
});
