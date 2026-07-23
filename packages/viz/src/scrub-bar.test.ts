import { describe, expect, it } from "vitest";
import type { EventRoot } from "@ballista/solverkit";
import {
  computeEventTicks,
  fractionToTime,
  snapToNearestEventTick,
  timeToFraction,
} from "./scrub-bar.js";

function fakeEventRoot(name: string, t: number, vy: number): EventRoot {
  return {
    event: { name, g: (_t: number, y: Float64Array) => y[3]! },
    t,
    theta: 0.5,
    y: new Float64Array([0, 0, 0, vy]),
    g: vy,
    iterations: 3,
    converged: true,
  };
}

describe("timeToFraction / fractionToTime", () => {
  it("round-trips within [0, duration]", () => {
    const duration = 4.2;
    for (const t of [0, 1, 2.1, duration]) {
      const fraction = timeToFraction(t, duration);
      expect(fractionToTime(fraction, duration)).toBeCloseTo(t, 12);
    }
  });

  it("clamps out-of-range times/fractions rather than extrapolating", () => {
    expect(timeToFraction(-1, 10)).toBe(0);
    expect(timeToFraction(11, 10)).toBe(1);
    expect(fractionToTime(-0.5, 10)).toBe(0);
    expect(fractionToTime(1.5, 10)).toBe(10);
  });

  it("maps everything to 0 when duration is 0 or negative", () => {
    expect(timeToFraction(5, 0)).toBe(0);
    expect(fractionToTime(0.5, 0)).toBe(0);
    expect(timeToFraction(5, -1)).toBe(0);
  });
});

describe("computeEventTicks", () => {
  it("maps events to sorted, normalized ticks", () => {
    const duration = 10;
    const events = [fakeEventRoot("apex", 7, 0), fakeEventRoot("splashdown", 2, -3)];
    const ticks = computeEventTicks(events, duration);

    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.label).toBe("splashdown");
    expect(ticks[0]!.t).toBe(2);
    expect(ticks[0]!.fraction).toBeCloseTo(0.2, 12);
    expect(ticks[1]!.label).toBe("apex");
    expect(ticks[1]!.t).toBe(7);
    expect(ticks[1]!.fraction).toBeCloseTo(0.7, 12);
  });

  it("returns no ticks when duration is 0 or negative", () => {
    const events = [fakeEventRoot("apex", 1, 0)];
    expect(computeEventTicks(events, 0)).toEqual([]);
    expect(computeEventTicks(events, -1)).toEqual([]);
  });

  it("returns no ticks for an empty event list", () => {
    expect(computeEventTicks([], 10)).toEqual([]);
  });
});

describe("snapToNearestEventTick", () => {
  const ticks = computeEventTicks(
    [fakeEventRoot("apex", 5.003, 0), fakeEventRoot("splashdown", 9.8, 0)],
    10,
  );

  it("snaps to a tick's exact time when within tolerance", () => {
    expect(snapToNearestEventTick(5.01, ticks, 0.05)).toBe(5.003);
  });

  it("leaves t unchanged when no tick is within tolerance", () => {
    expect(snapToNearestEventTick(7, ticks, 0.05)).toBe(7);
  });

  it("snaps to the nearest of multiple ticks, not just the first", () => {
    expect(snapToNearestEventTick(9.79, ticks, 0.5)).toBe(9.8);
  });

  it("is a no-op with no ticks", () => {
    expect(snapToNearestEventTick(3, [], 1)).toBe(3);
  });
});
