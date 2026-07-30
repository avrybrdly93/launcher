import { describe, expect, it } from "vitest";
import {
  computeViewDomain,
  dataXToScreenX,
  dataYToScreenY,
  formatMeters,
  profileToSvgPolylinePoints,
  sampleTerrainProfile,
  screenXToDataX,
  screenYToDataY,
} from "./terrain-editor-page-logic.js";

const POINTS = [
  { x: 0, y: 0 },
  { x: 50, y: 10 },
  { x: 100, y: 0 },
];

describe("computeViewDomain", () => {
  it("spans every control point with padding on every side", () => {
    const domain = computeViewDomain(POINTS);
    expect(domain.minX).toBeLessThan(0);
    expect(domain.maxX).toBeGreaterThan(100);
    expect(domain.minY).toBeLessThan(0);
    expect(domain.maxY).toBeGreaterThan(10);
  });

  it("widens to include extra x/y samples (e.g. a trajectory's extent)", () => {
    const domain = computeViewDomain(POINTS, [150], [40]);
    expect(domain.maxX).toBeGreaterThan(150);
    expect(domain.maxY).toBeGreaterThan(40);
  });

  it("never degenerates to a zero-width/height domain for a single flat point pair", () => {
    const domain = computeViewDomain([
      { x: 0, y: 0 },
      { x: 0.0001, y: 0 },
    ]);
    expect(domain.maxX - domain.minX).toBeGreaterThan(0);
    expect(domain.maxY - domain.minY).toBeGreaterThan(0);
  });
});

describe("screen<->data mapping", () => {
  const domain = computeViewDomain(POINTS);
  const width = 800;
  const height = 400;

  it("dataXToScreenX and screenXToDataX are inverses", () => {
    for (const x of [0, 25, 50, 75, 100]) {
      const screenX = dataXToScreenX(domain, width, x);
      expect(screenXToDataX(domain, width, screenX)).toBeCloseTo(x, 9);
    }
  });

  it("dataYToScreenY and screenYToDataY are inverses", () => {
    for (const y of [-2, 0, 5, 10]) {
      const screenY = dataYToScreenY(domain, height, y);
      expect(screenYToDataY(domain, height, screenY)).toBeCloseTo(y, 9);
    }
  });

  it("dataYToScreenY flips: a higher data-y maps to a smaller screen-y", () => {
    const screenYLow = dataYToScreenY(domain, height, 0);
    const screenYHigh = dataYToScreenY(domain, height, 10);
    expect(screenYHigh).toBeLessThan(screenYLow);
  });
});

describe("sampleTerrainProfile", () => {
  it("passes through the control points' own height at their x", () => {
    const domain = computeViewDomain(POINTS);
    const profile = sampleTerrainProfile(POINTS, domain, 500);
    for (const p of POINTS) {
      const nearest = profile.reduce((best, candidate) =>
        Math.abs(candidate.x - p.x) < Math.abs(best.x - p.x) ? candidate : best,
      );
      expect(nearest.y).toBeCloseTo(p.y, 1);
    }
  });

  it("samples sampleCount points spanning the full domain", () => {
    const domain = computeViewDomain(POINTS);
    const profile = sampleTerrainProfile(POINTS, domain, 10);
    expect(profile).toHaveLength(10);
    expect(profile[0]!.x).toBeCloseTo(domain.minX, 9);
    expect(profile[profile.length - 1]!.x).toBeCloseTo(domain.maxX, 9);
  });
});

describe("profileToSvgPolylinePoints", () => {
  it("produces a space-separated list of comma-separated screen coordinates", () => {
    const domain = computeViewDomain(POINTS);
    const svg = profileToSvgPolylinePoints(
      [
        { x: 0, y: 0 },
        { x: 50, y: 10 },
      ],
      domain,
      800,
      400,
    );
    const pairs = svg.split(" ");
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.split(",")).toHaveLength(2);
    }
  });
});

describe("formatMeters", () => {
  it("formats to one decimal place with a unit suffix", () => {
    expect(formatMeters(12.345)).toBe("12.3 m");
    expect(formatMeters(0)).toBe("0.0 m");
    expect(formatMeters(-1.05)).toBe("-1.1 m");
  });
});
