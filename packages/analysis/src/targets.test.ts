import {
  ConstantAtmosphere,
  ConstantCd,
  Environment,
  G_STD,
  GravityForce,
  UniformGravity,
  ZeroWind,
  createEvalContext,
  createPlanarProjectileModel,
  createSphericalProjectileParams,
} from "@ballista/engine";
import {
  TrajectoryRecorder,
  createDormandPrince54Stepper,
  integrate,
  type Trajectory,
} from "@ballista/solverkit";
import { describe, expect, it } from "vitest";

import { PLANAR_LAYOUT, SPATIAL_LAYOUT, impactPoint, missDistance } from "./observables.js";
import {
  type PlatformTarget,
  type PointTarget,
  type RingTarget,
  type Target,
  impactIsHit,
  impactMissVector,
  isHit,
  missMagnitude,
  missVector,
  nearestPointOn,
  validateTarget,
} from "./targets.js";

/**
 * P5.02's validation criterion is "miss vector zero at exact hit
 * (constructed)". Every hit case below is therefore *constructed* — a point
 * placed on the target set by hand, with no solver in the loop — and asserted
 * to give a **bit-exact** zero via `toBe(0)`, not a small number via a
 * tolerance. That distinction is the whole test: a nearest-point routine that
 * scales coordinates by a ratio which happens to equal 1 returns something
 * within an ulp of the input rather than the input, and `toBeCloseTo` cannot
 * tell the two apart. `toBe(0)` can.
 *
 * The miss cases are checked against closed-form geometry (a radial
 * displacement of `r - radius`, a per-axis box clamp), never against a
 * previous run of this code.
 */

/** Asserts a miss vector is componentwise exactly zero. */
function expectExactZero(miss: readonly number[]): void {
  for (const component of miss) {
    expect(component).toBe(0);
    // `toBe` uses Object.is, so -0 would pass the check above while breaking
    // any downstream sign test. Pin the sign too.
    expect(Object.is(component, -0)).toBe(false);
  }
}

describe("P5.02 point target", () => {
  const target: PointTarget = { kind: "point", center: [120, 0], tolerance: 0.5 };

  it("miss vector is exactly zero at the constructed exact hit", () => {
    expectExactZero(missVector(target, [120, 0], PLANAR_LAYOUT));
    expect(missMagnitude(target, [120, 0], PLANAR_LAYOUT)).toBe(0);
    expect(isHit(target, [120, 0], PLANAR_LAYOUT)).toBe(true);
  });

  it("miss vector is impact minus target — the sign convention P5.04's residual uses", () => {
    // F = r_impact - r*, so overshooting downrange must give a *positive*
    // first component. A flipped sign here would make a Newton step in P5.06
    // walk away from the target, which no magnitude-only assertion catches.
    expect(missVector(target, [123, 4], PLANAR_LAYOUT)).toEqual([3, 4]);
    expect(missMagnitude(target, [123, 4], PLANAR_LAYOUT)).toBeCloseTo(5, 12);
  });

  it("the hit predicate honours the target's own tolerance", () => {
    expect(isHit(target, [120.4, 0], PLANAR_LAYOUT)).toBe(true);
    expect(isHit(target, [120.6, 0], PLANAR_LAYOUT)).toBe(false);
    // Exactly at the tolerance is a hit: `<=`, not `<`.
    expect(isHit(target, [120.5, 0], PLANAR_LAYOUT)).toBe(true);
  });

  it("defaults to a zero tolerance, so only an exact hit counts", () => {
    const strict: PointTarget = { kind: "point", center: [10, 0] };
    expect(isHit(strict, [10, 0], PLANAR_LAYOUT)).toBe(true);
    expect(isHit(strict, [10 + 1e-15, 0], PLANAR_LAYOUT)).toBe(false);
  });

  it("agrees with P5.01's missDistance scalar", () => {
    // The two were written independently — observables.missDistance walks the
    // trajectory, targets.missMagnitude walks a target set — so agreeing is
    // evidence, not a tautology.
    const traj = simulateDragFree(45, 50);
    const point = impactPoint(traj, PLANAR_LAYOUT);
    const centre = [point[0]! + 7, point[1]! - 24];
    const pointTarget: PointTarget = { kind: "point", center: centre };
    expect(missMagnitude(pointTarget, point, PLANAR_LAYOUT)).toBeCloseTo(
      missDistance(traj, centre, PLANAR_LAYOUT),
      12,
    );
  });
});

describe("P5.02 ring target (filled disc)", () => {
  const target: RingTarget = { kind: "ring", center: [200, 0], radius: 10 };

  it("miss vector is exactly zero anywhere on the disc", () => {
    for (const x of [190, 195, 200, 204.5, 210]) {
      expectExactZero(missVector(target, [x, 0], PLANAR_LAYOUT));
      expect(isHit(target, [x, 0], PLANAR_LAYOUT)).toBe(true);
    }
  });

  it("a constructed hit needs no tolerance — a shape with area gives an exact-zero miss", () => {
    expect(target.tolerance).toBeUndefined();
    expect(isHit(target, [204.5, 0], PLANAR_LAYOUT)).toBe(true);
  });

  it("outside the rim, the miss is the radial overshoot", () => {
    // Landing 3 m past the far rim: r = 13, radius = 10, so the miss is 3 m
    // outward, and the nearest point is the rim itself.
    expect(missVector(target, [213, 0], PLANAR_LAYOUT)).toEqual([3, 0]);
    expect(nearestPointOn(target, [213, 0], PLANAR_LAYOUT)).toEqual([210, 0]);
    // Short of the near rim, the miss points the other way.
    expect(missVector(target, [185, 0], PLANAR_LAYOUT)).toEqual([-5, 0]);
  });

  it("landing at the ring height but off-plane still misses vertically", () => {
    // Directly above the centre by 4 m: the disc is flat, so the nearest
    // point is the centre and the whole miss is vertical.
    expect(missVector(target, [200, 4], PLANAR_LAYOUT)).toEqual([0, 4]);
  });

  it("the interior stays exact for coordinates that do not round-trip through the centre", () => {
    // Deliberately adversarial values. Reconstructing an interior point as
    // `centre + (point - centre) * scale` with `scale === 1` is algebraically
    // the identity but *not* the identity in floating point:
    // `10.1 + (30.3 - 10.1)` is `30.300000000000004`, not `30.3`. That
    // residual would make the miss vector 3.6e-15 instead of zero and quietly
    // break the exact-hit criterion. The nearest-point routine copies
    // interior components across instead of scaling them by a ratio that
    // happens to be 1, and this case is what holds it to that — verified by
    // negative control: forcing the scaling path fails exactly this test.
    const decimal: RingTarget = { kind: "ring", center: [10.1, 0], radius: 25 };
    expectExactZero(missVector(decimal, [30.3, 0], PLANAR_LAYOUT));
    expect(isHit(decimal, [30.3, 0], PLANAR_LAYOUT)).toBe(true);
  });

  it("the exact rim is a hit, and just outside it is not — the boundary is not fudged", () => {
    expectExactZero(missVector(target, [210, 0], PLANAR_LAYOUT));
    expect(missMagnitude(target, [210 + 1e-9, 0], PLANAR_LAYOUT)).toBeGreaterThan(0);
  });

  it("the miss magnitude goes continuously to zero at the boundary", () => {
    // P5.04 drives this to zero with a Newton method; a discontinuity or a
    // kink of the wrong sign at the boundary would break the iteration
    // exactly where it converges.
    let previous = Infinity;
    for (const overshoot of [1, 1e-1, 1e-2, 1e-3, 1e-6, 1e-9]) {
      const m = missMagnitude(target, [210 + overshoot, 0], PLANAR_LAYOUT);
      expect(m).toBeCloseTo(overshoot, 12);
      expect(m).toBeLessThan(previous);
      previous = m;
    }
  });
});

describe("P5.02 ring target (annulus)", () => {
  const target: RingTarget = { kind: "ring", center: [0, 0], radius: 10, innerRadius: 4 };

  it("miss vector is exactly zero on the band, including both rims", () => {
    for (const x of [4, 6, 10, -4, -7, -10]) {
      expectExactZero(missVector(target, [x, 0], PLANAR_LAYOUT));
    }
  });

  it("the hole is a miss — this is what distinguishes an annulus from a disc", () => {
    expect(missVector(target, [1, 0], PLANAR_LAYOUT)).toEqual([-3, 0]);
    expect(missMagnitude(target, [1, 0], PLANAR_LAYOUT)).toBeCloseTo(3, 12);
    expect(isHit(target, [1, 0], PLANAR_LAYOUT)).toBe(false);
  });

  it("the dead centre resolves deterministically rather than to NaN", () => {
    // Equidistant from the entire inner rim: there is no canonical nearest
    // point, so the documented choice is the first horizontal axis. What
    // matters for a solver stepping through the centre is that it is stable
    // and finite, which a naive `d / r` with `r = 0` is not.
    const miss = missVector(target, [0, 0], PLANAR_LAYOUT);
    expect(miss.every(Number.isFinite)).toBe(true);
    expect(miss).toEqual([-4, 0]);
    expect(missMagnitude(target, [0, 0], PLANAR_LAYOUT)).toBeCloseTo(4, 12);
  });
});

describe("P5.02 raised platform target", () => {
  // A 12 m x (planar: single axis) pad whose top surface is 25 m up.
  const target: PlatformTarget = { kind: "platform", center: [300, 25], halfExtents: [6] };

  it("miss vector is exactly zero anywhere on the pad's top surface", () => {
    for (const x of [294, 297, 300, 303.25, 306]) {
      expectExactZero(missVector(target, [x, 25], PLANAR_LAYOUT));
      expect(isHit(target, [x, 25], PLANAR_LAYOUT)).toBe(true);
    }
  });

  it("the right downrange distance at the wrong height is a miss, purely vertical", () => {
    // The case observables.missDistance's doc singles out: this shot hit the
    // side of the platform, not the top. A horizontal-only miss would report
    // zero here and make P5.04's residual blind to it.
    expect(missVector(target, [300, 0], PLANAR_LAYOUT)).toEqual([0, -25]);
    expect(isHit(target, [300, 0], PLANAR_LAYOUT)).toBe(false);
    expect(missVector(target, [300, 31], PLANAR_LAYOUT)).toEqual([0, 6]);
  });

  it("past the edge, the miss clamps per axis", () => {
    expect(missVector(target, [310, 25], PLANAR_LAYOUT)).toEqual([4, 0]);
    expect(missVector(target, [290, 25], PLANAR_LAYOUT)).toEqual([-4, 0]);
    // Past the edge *and* below: both components are live at once.
    expect(missVector(target, [310, 20], PLANAR_LAYOUT)).toEqual([4, -5]);
  });

  it("a zero half-extent degenerates to a point target at that height", () => {
    const degenerate: PlatformTarget = { kind: "platform", center: [50, 10], halfExtents: [0] };
    expectExactZero(missVector(degenerate, [50, 10], PLANAR_LAYOUT));
    expect(missVector(degenerate, [53, 10], PLANAR_LAYOUT)).toEqual([3, 0]);
  });
});

describe("P5.02 targets in 3D (SPATIAL_LAYOUT)", () => {
  it("a ring uses both horizontal axes and ignores neither", () => {
    const target: RingTarget = { kind: "ring", center: [100, 0, 50], radius: 5 };
    // (103, 54) is 5 m from (100, 50) on the 3-4-5 triangle: exactly on the rim.
    expectExactZero(missVector(target, [103, 0, 54], SPATIAL_LAYOUT));
    // Doubling that displacement puts it 5 m outside, along the same bearing.
    expect(missVector(target, [106, 0, 58], SPATIAL_LAYOUT)).toEqual([3, 0, 4]);
  });

  it("a platform takes one half-extent per horizontal axis", () => {
    const target: PlatformTarget = {
      kind: "platform",
      center: [100, 30, -20],
      halfExtents: [8, 3],
    };
    expectExactZero(missVector(target, [105, 30, -22], SPATIAL_LAYOUT));
    expect(missVector(target, [110, 30, -25], SPATIAL_LAYOUT)).toEqual([2, 0, -2]);
  });

  it("a spatial target rejects a planar centre before it can produce NaN", () => {
    const target: PointTarget = { kind: "point", center: [1, 2] };
    expect(() => missVector(target, [1, 2, 3], SPATIAL_LAYOUT)).toThrow(/3/);
  });
});

describe("P5.02 target validation", () => {
  const cases: readonly (readonly [string, Target, RegExp])[] = [
    ["centre of the wrong length", { kind: "point", center: [1, 2, 3] }, /center has 3 component/],
    ["non-finite centre", { kind: "point", center: [1, NaN] }, /must be finite/],
    ["negative tolerance", { kind: "point", center: [1, 2], tolerance: -1 }, /tolerance must be/],
    [
      "ring radius below its inner radius",
      { kind: "ring", center: [0, 0], radius: 2, innerRadius: 5 },
      /smaller than innerRadius/,
    ],
    [
      "negative inner radius",
      { kind: "ring", center: [0, 0], radius: 5, innerRadius: -1 },
      /innerRadius must be/,
    ],
    [
      "platform half-extents of the wrong arity",
      { kind: "platform", center: [0, 0], halfExtents: [1, 2] },
      /halfExtents has 2 entry/,
    ],
    [
      "negative half-extent",
      { kind: "platform", center: [0, 0], halfExtents: [-1] },
      /halfExtents\[0\] must be/,
    ],
  ];

  for (const [name, target, message] of cases) {
    it(`rejects a ${name}`, () => {
      expect(() => validateTarget(target, PLANAR_LAYOUT)).toThrow(message);
      // The predicates must not be a way around the validation.
      expect(() => missVector(target, [0, 0], PLANAR_LAYOUT)).toThrow(message);
    });
  }

  it("rejects a query point whose arity does not match the layout", () => {
    const target: PointTarget = { kind: "point", center: [1, 2] };
    expect(() => missVector(target, [1, 2, 3], PLANAR_LAYOUT)).toThrow(/point has 3 component/);
  });
});

describe("P5.02 against a real trajectory", () => {
  const traj = simulateDragFree(40, 65);

  it("a target placed on the recorded impact point is an exact hit", () => {
    const point = impactPoint(traj, PLANAR_LAYOUT);
    const target: PointTarget = { kind: "point", center: point };
    expectExactZero(impactMissVector(traj, target, PLANAR_LAYOUT));
    expect(impactIsHit(traj, target, PLANAR_LAYOUT)).toBe(true);
  });

  it("a ring around the analytic impact point is hit; one displaced past its rim is not", () => {
    // Closed form, not a prior run: a drag-free launch from y=0 lands at
    // R = v0^2 sin(2θ)/g.
    const theta = (40 * Math.PI) / 180;
    const analyticRange = (65 * 65 * Math.sin(2 * theta)) / G_STD;

    // The tolerance is not decoration. All three target shapes are flat, so
    // the miss picks up the impact's vertical coordinate — and event
    // localization puts that at ~1e-15 m rather than at 0. A zero-tolerance
    // flat target is therefore never hit by a *solved* trajectory, only by a
    // constructed point. Asserted below rather than merely asserted-around,
    // because it is the surprising half.
    const onTarget: RingTarget = { kind: "ring", center: [analyticRange, 0], radius: 1 };
    const strict: RingTarget = { ...onTarget, tolerance: 0 };
    const miss = impactMissVector(traj, strict, PLANAR_LAYOUT);
    expect(miss[0]).toBe(0); // horizontally inside the ring: exactly on it
    expect(miss[1]).not.toBe(0); // vertically: the event-localization residual
    expect(Math.abs(miss[1]!)).toBeLessThan(1e-9);
    expect(impactIsHit(traj, strict, PLANAR_LAYOUT)).toBe(false);

    const forgiving: RingTarget = { ...onTarget, tolerance: 1e-6 };
    expect(impactIsHit(traj, forgiving, PLANAR_LAYOUT)).toBe(true);

    // Move the ring 5 m downrange with a 1 m radius: the shot now falls 4 m
    // short of the near rim, up to the solver's event-localization error.
    const displaced: RingTarget = {
      kind: "ring",
      center: [analyticRange + 5, 0],
      radius: 1,
      tolerance: 1e-6,
    };
    expect(impactIsHit(traj, displaced, PLANAR_LAYOUT)).toBe(false);
    const displacedMiss = impactMissVector(traj, displaced, PLANAR_LAYOUT);
    expect(displacedMiss[0]!).toBeCloseTo(-4, 8);
    expect(displacedMiss[1]!).toBeCloseTo(0, 8);
  });

  it("a platform at ground level under the impact point is hit; the same pad raised is not", () => {
    const point = impactPoint(traj, PLANAR_LAYOUT);
    const onGround: PlatformTarget = {
      kind: "platform",
      center: [point[0]!, point[1]!],
      halfExtents: [5],
    };
    expect(impactIsHit(traj, onGround, PLANAR_LAYOUT)).toBe(true);

    const raised: PlatformTarget = {
      kind: "platform",
      center: [point[0]!, point[1]! + 12],
      halfExtents: [5],
    };
    expect(impactIsHit(traj, raised, PLANAR_LAYOUT)).toBe(false);
    expect(impactMissVector(traj, raised, PLANAR_LAYOUT)[1]!).toBeCloseTo(-12, 8);
  });
});

/**
 * Integrates a drag-free launch to ground impact. Same construction as
 * `observables.test.ts` — `ConstantCd(0)` with only `GravityForce` wired makes
 * the dynamics exactly $\ddot y = -g$, $\ddot x = 0$ — so the recorded impact
 * row is the event-localized ground crossing and the analytic range is a fair
 * reference for it.
 */
function simulateDragFree(thetaDeg: number, v0: number): Trajectory {
  const env = new Environment(
    new ConstantAtmosphere(),
    new UniformGravity(G_STD, false),
    new ZeroWind(),
  );
  const params = createSphericalProjectileParams({
    mass: 1,
    radius: 0.05,
    dragCoefficient: new ConstantCd(0),
  });
  const ctx = createEvalContext(env, params);
  const model = createPlanarProjectileModel([new GravityForce()]);

  const theta = (thetaDeg * Math.PI) / 180;
  const y0 = new Float64Array([0, 0, v0 * Math.cos(theta), v0 * Math.sin(theta)]);
  const stepper = createDormandPrince54Stepper();
  const recorder = new TrajectoryRecorder();

  const report = integrate(
    model,
    ctx,
    y0,
    [0, 200],
    { stepper: stepper.info.id, h: 0.05, rtol: 1e-13, atol: 1e-14, maxSteps: 200_000 },
    stepper,
    [recorder],
  );

  expect(report.status).toBe("ok");
  return recorder.trajectory;
}
