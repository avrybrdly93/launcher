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
import { assessReachability, computeEnvelope, maxHeightAtDownrange } from "./envelope.js";
import { PLANAR_LAYOUT } from "./observables.js";
import type { ShootingProblem } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.09's validation criterion is "unreachable target reported with
 * distance-to-envelope", and the whole file is built so that the reference is
 * never this code run twice.
 *
 * Drag-free, the reachable set at a fixed speed is bounded by the **parabola of
 * safety**
 *
 *   $y_{\max}(x) = v_0^2/2g - g x^2 / 2 v_0^2$,
 *
 * which meets the ground at $x = v_0^2/g$ and is touched at abscissa $x$ by the
 * arc with $\tan\theta = v_0^2/(gx)$. None of those three facts is used by the
 * implementation — it sweeps elevations and integrates — so each is an
 * independent check rather than an algebraic restatement.
 *
 * The distance reference is computed the same way: brute force over the
 * *closed-form* parabola on a fine grid, with no integration anywhere in it. If
 * the implementation's minimization converged to the wrong basin, or measured a
 * vertical drop while calling it a distance, that reference disagrees.
 */

const V0 = 40;

/** Tighter than an interactive tolerance, looser than `arcs.test.ts`'s 1e-12. */
const TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-11,
  atol: 1e-13,
  maxSteps: 200_000,
};

/**
 * Test-scale option overrides. The defaults are sized for a UI asking one
 * question; a file that asks a few hundred wants the same geometry for fewer
 * integrations, and the assertions below are loose enough to be met at these
 * settings — deliberately, since a tolerance tuned to the last digit of a
 * particular sweep count would be measuring the sweep and not the envelope.
 */
const FAST = { sweepSamples: 12, angleTol: 1e-6 } as const;

const TARGET: PointTarget = { kind: "point", center: [10, 0] };

function problem(cd = 0, launchPoint = [0, 0]): ShootingProblem {
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
    target: TARGET,
    launchPoint,
    config: TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

/** The parabola of safety: the drag-free envelope, in closed form. */
function safetyParabola(x: number, v0 = V0): number {
  return (v0 * v0) / (2 * G_STD) - (G_STD * x * x) / (2 * v0 * v0);
}

/** Drag-free maximum range, where the parabola meets the ground. */
const MAX_RANGE = (V0 * V0) / G_STD;

/**
 * Distance from a point to the closed-form parabola, by dense scan plus a
 * local golden-section refinement. No integration, no shared code with the
 * module under test.
 */
function referenceDistance(targetX: number, targetY: number): number {
  const d2 = (x: number): number => {
    const dx = x - targetX;
    const dy = safetyParabola(x) - targetY;
    return dx * dx + dy * dy;
  };
  const n = 200_001;
  let bestX = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * MAX_RANGE;
    const value = d2(x);
    if (value < best) {
      best = value;
      bestX = x;
    }
  }
  // Refine within one grid cell either side.
  const h = MAX_RANGE / (n - 1);
  let a = Math.max(0, bestX - h);
  let b = Math.min(MAX_RANGE, bestX + h);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = d2(c);
  let fd = d2(d);
  for (let i = 0; i < 200 && b - a > 1e-12; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = d2(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = d2(d);
    }
  }
  return Math.sqrt(d2((a + b) / 2));
}

function relErr(actual: number, expected: number): number {
  const scale = Math.abs(expected);
  return scale > 1e-12 ? Math.abs(actual - expected) / scale : Math.abs(actual - expected);
}

describe("P5.09 envelope vs the drag-free parabola of safety", () => {
  const p = problem(0);

  for (const fraction of [0.1, 0.3, 0.5, 0.75, 0.9]) {
    const x = fraction * MAX_RANGE;

    it(`height matches v0^2/2g - g x^2/2 v0^2 at x = ${(fraction * 100).toFixed(0)}% of max range`, () => {
      const got = maxHeightAtDownrange(p, V0, x, FAST);
      expect(got).not.toBeNull();
      expect(relErr(got!.height, safetyParabola(x))).toBeLessThan(1e-6);
    });

    it(`the touching arc has tan(theta) = v0^2/(g x) at ${(fraction * 100).toFixed(0)}%`, () => {
      const got = maxHeightAtDownrange(p, V0, x, FAST);
      const wanted = Math.atan((V0 * V0) / (G_STD * x));
      expect(Math.abs(got!.theta - wanted)).toBeLessThan(1e-4);
    });
  }

  it("the boundary meets the ground at the maximum range v0^2/g", () => {
    const envelope = computeEnvelope(p, V0, 6, FAST);
    expect(relErr(envelope.maxDownrange, MAX_RANGE)).toBeLessThan(1e-6);
    // ...achieved at 45 degrees, which the sweep measured rather than assumed.
    expect(Math.abs(envelope.maxRangeAngle - Math.PI / 4)).toBeLessThan(1e-4);
  });

  it("approaches v0^2/2g just right of the launch point, the vertical shot's apex", () => {
    // The left end of the curve is the degenerate one: the maximizing elevation
    // goes to pi/2 as x -> 0, where the arc is a vertical segment and the
    // feasible band of elevations closes up against the bound. The maximum is
    // therefore found pressed against maxAngle rather than in an interior
    // bracket, and 1e-3 relative is what a sweep-and-contract resolves it to —
    // stated as the measured accuracy rather than tightened until it passes.
    const got = maxHeightAtDownrange(p, V0, 1e-3, FAST);
    expect(got).not.toBeNull();
    expect(relErr(got!.height, safetyParabola(1e-3))).toBeLessThan(1e-3);
    expect(got!.theta).toBeGreaterThan(1.5);
  });

  it("samples a boundary that is concave and descending to the ground", () => {
    const envelope = computeEnvelope(p, V0, 9, FAST);
    expect(envelope.points.length).toBeGreaterThanOrEqual(8);
    const heights = envelope.points.map((point) => point.height);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeLessThan(heights[i - 1]!);
    }
    expect(Math.abs(heights[heights.length - 1]!)).toBeLessThan(1e-3);
  });
});

describe("P5.09 validation: unreachable targets report a distance to the envelope", () => {
  const p = problem(0);

  /**
   * Three ways to be outside the region, all of which a correct
   * distance-to-envelope has to handle differently:
   *
   * - **too high** — inside the maximum range but above the boundary, so the
   *   nearest point is overhead-ish and the distance is much less than the
   *   vertical drop would suggest;
   * - **too far** — past the maximum range at ground level, where the nearest
   *   boundary point is the curve's ground endpoint and the answer is close to
   *   the plain shortfall P5.08 reports;
   * - **both** — beyond and above, where neither degenerate reading is right.
   */
  const CASES: readonly { name: string; x: number; y: number }[] = [
    { name: "too high, mid-range", x: 0.4 * MAX_RANGE, y: safetyParabola(0.4 * MAX_RANGE) + 30 },
    { name: "too far, on the ground", x: 1.25 * MAX_RANGE, y: 0 },
    { name: "beyond and above", x: 1.1 * MAX_RANGE, y: 40 },
    { name: "just outside", x: 0.6 * MAX_RANGE, y: safetyParabola(0.6 * MAX_RANGE) + 2 },
  ];

  for (const c of CASES) {
    it(`${c.name}: reported unreachable with the closed-form distance`, () => {
      const report = assessReachability(p, V0, [c.x, c.y], { ...FAST, boundarySamples: 12 });
      expect(report.reachable).toBe(false);
      expect(report.distanceToEnvelope).toBeGreaterThan(0);

      const wanted = referenceDistance(c.x, c.y);
      expect(relErr(report.distanceToEnvelope, wanted)).toBeLessThan(1e-3);
    });
  }

  it("the distance is Euclidean, strictly under the vertical drop when the boundary slopes", () => {
    const x = 0.7 * MAX_RANGE;
    const y = safetyParabola(x) + 50;
    const report = assessReachability(p, V0, [x, y], { ...FAST, boundarySamples: 12 });
    expect(report.heightMargin).not.toBeNull();
    const verticalDrop = -report.heightMargin!;
    expect(verticalDrop).toBeGreaterThan(49);
    // A sloping boundary always has a nearer point than the one directly below,
    // so an implementation that reported the vertical gap would fail this.
    expect(report.distanceToEnvelope).toBeLessThan(verticalDrop);
  });

  it("names the nearest boundary point, and it lies on the envelope", () => {
    const x = 0.5 * MAX_RANGE;
    const y = safetyParabola(x) + 25;
    const report = assessReachability(p, V0, [x, y], { ...FAST, boundarySamples: 12 });
    expect(report.nearestEnvelopePoint).not.toBeNull();
    const [nx, ny] = report.nearestEnvelopePoint!;
    expect(relErr(ny, safetyParabola(nx))).toBeLessThan(1e-5);
  });

  it("reports a target beyond the maximum range with a null envelope height", () => {
    const report = assessReachability(p, V0, [1.4 * MAX_RANGE, 0], {
      ...FAST,
      boundarySamples: 12,
    });
    expect(report.envelopeHeight).toBeNull();
    expect(report.heightMargin).toBeNull();
    expect(report.reachable).toBe(false);
    expect(report.distanceToEnvelope).toBeGreaterThan(0);
  });
});

describe("P5.09 reachable targets", () => {
  const p = problem(0);

  it("a target under the boundary is reachable with zero distance and positive margin", () => {
    const x = 0.5 * MAX_RANGE;
    const report = assessReachability(p, V0, [x, safetyParabola(x) - 40], {
      ...FAST,
      boundarySamples: 12,
    });
    expect(report.reachable).toBe(true);
    expect(report.distanceToEnvelope).toBe(0);
    expect(report.nearestEnvelopePoint).toBeNull();
    expect(report.heightMargin!).toBeGreaterThan(39);
  });

  it("a ground target inside the maximum range is reachable", () => {
    const report = assessReachability(p, V0, [0.5 * MAX_RANGE, 0], {
      ...FAST,
      boundarySamples: 12,
    });
    expect(report.reachable).toBe(true);
    expect(report.distanceToEnvelope).toBe(0);
  });

  it("the boundary is the exact dividing line: just under reaches, just over does not", () => {
    const x = 0.45 * MAX_RANGE;
    const boundary = safetyParabola(x);
    const under = assessReachability(p, V0, [x, boundary - 0.5], { ...FAST, boundarySamples: 12 });
    const over = assessReachability(p, V0, [x, boundary + 0.5], { ...FAST, boundarySamples: 12 });
    expect(under.reachable).toBe(true);
    expect(over.reachable).toBe(false);
  });
});

describe("P5.09 with drag, where no closed form applies", () => {
  const p = problem(0.47);

  it("drag shrinks the reachable set: envelope strictly inside the drag-free one", () => {
    const drag = computeEnvelope(p, V0, 7, FAST);
    expect(drag.maxDownrange).toBeLessThan(MAX_RANGE);
    for (const point of drag.points) {
      if (point.downrange <= 0) continue;
      expect(point.height).toBeLessThan(safetyParabola(point.downrange));
    }
  });

  it("the max-range elevation is pulled below 45 degrees", () => {
    const drag = computeEnvelope(p, V0, 3, FAST);
    expect(drag.maxRangeAngle).toBeLessThan(Math.PI / 4);
  });

  it("still separates reachable from unreachable, measured against its own boundary", () => {
    const drag = computeEnvelope(p, V0, 9, FAST);
    const mid = drag.points[Math.floor(drag.points.length / 2)]!;
    const under = assessReachability(p, V0, [mid.downrange, mid.height - 5], {
      ...FAST,
      boundarySamples: 10,
    });
    const over = assessReachability(p, V0, [mid.downrange, mid.height + 5], {
      ...FAST,
      boundarySamples: 10,
    });
    expect(under.reachable).toBe(true);
    expect(over.reachable).toBe(false);
    expect(over.distanceToEnvelope).toBeGreaterThan(0);
    expect(over.distanceToEnvelope).toBeLessThanOrEqual(5.0001);
  });
});

describe("P5.09 guard rails", () => {
  const p = problem(0);

  it("rejects a non-positive speed", () => {
    expect(() => maxHeightAtDownrange(p, 0, 10, FAST)).toThrow(/speed must be finite and positive/);
    expect(() => assessReachability(p, -1, [10, 0], FAST)).toThrow(
      /speed must be finite and positive/,
    );
  });

  it("rejects a non-finite abscissa or target", () => {
    expect(() => maxHeightAtDownrange(p, V0, Number.NaN, FAST)).toThrow(/must be finite/);
    expect(() => assessReachability(p, V0, [Number.NaN, 0], FAST)).toThrow(/must be finite/);
  });

  it("rejects malformed sweep and sample counts", () => {
    expect(() => maxHeightAtDownrange(p, V0, 10, { sweepSamples: 2 })).toThrow(/sweepSamples/);
    expect(() => computeEnvelope(p, V0, 1, FAST)).toThrow(/samples must be an integer/);
    expect(() => assessReachability(p, V0, [10, 0], { ...FAST, boundarySamples: 2 })).toThrow(
      /boundarySamples/,
    );
  });

  it("returns null above an abscissa nothing reaches", () => {
    expect(maxHeightAtDownrange(p, V0, MAX_RANGE * 2, FAST)).toBeNull();
  });
});
