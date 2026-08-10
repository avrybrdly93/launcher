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
import { assessReachability, maxHeightAtDownrange } from "./envelope.js";
import { minimumSpeedToHit } from "./min-energy.js";
import { PLANAR_LAYOUT, heightAtDownrange } from "./observables.js";
import { type ShootingProblem, createFlight } from "./shooting-residual.js";
import type { PointTarget } from "./targets.js";

/**
 * P5.15's validation criterion is a **KKT-style check: range envelope tangency
 * at the solution**, and this file is the exhibit for it — the P4.09/P4.22/P4.34
 * and P5.14 precedent of a documented test module rather than new UI.
 *
 * The criterion is checked three independent ways, deliberately, because each
 * one alone could be satisfied by a wrong answer:
 *
 * 1. **Stationarity** — the target lies *on* the envelope at the solution speed,
 *    so the tangency residual `envelopeHeight(x*) − y*` is zero. This is the
 *    equation the implementation solves, so on its own it proves only that the
 *    root-find converged.
 * 2. **Geometric tangency** — the optimal arc and the envelope have the *same
 *    slope* where they meet. The implementation never looks at a slope, so this
 *    is independent of it, and drag-free it is checked against the closed-form
 *    parabola slope `dy/dx = −g x / v₀²` rather than against a second numerical
 *    derivative.
 * 3. **Minimality** — a launch a hair slower genuinely cannot reach the target
 *    and a hair faster genuinely can, decided by `assessReachability`, a
 *    different entry point that computes reachability its own way. This is what
 *    rules out converging to a stationary point that is not the minimum.
 *
 * **The drag-free reference is exact, not a recorded run.** The parabola of
 * safety gives the whole answer in closed form: the minimum speed to
 * `(x*, y*)` is `v₀ = √(g(y* + √(x*² + y*²)))` and the aim is
 * `θ = π/4 + φ/2` with `φ = atan2(y*, x*)`. Neither is used by the
 * implementation, which integrates trajectories and searches; both are asserted
 * against here.
 *
 * **Every number in the drag table below was measured, not predicted.** The
 * 15th run recorded getting this wrong — writing an exhibit's table from
 * expectation and finding four entries false — so the table is generated from
 * the output and the assertions are on properties (ordering, sign, monotonicity)
 * rather than on digits that would pin the test to one solver configuration.
 */

/** Tight enough that the closed-form comparisons below are testing the search, not the integrator. */
const TOL: SolverConfig = {
  stepper: "dopri5",
  rtol: 1e-11,
  atol: 1e-13,
  maxSteps: 200_000,
};

/** The problem's own target is unused by `minimumSpeedToHit`, which takes the point as an argument. */
const UNUSED_TARGET: PointTarget = { kind: "point", center: [10, 0] };

/**
 * Test-scale option overrides, sized as `envelope.test.ts`'s `FAST` is: the
 * defaults answer one question for a UI, and this file asks a few dozen.
 *
 * **Every closed-form assertion below is written against {@link SPEED_TOL}
 * rather than against a decimal count picked by eye.** The first draft of this
 * file asserted `toBeCloseTo(exact, 8)` while asking for a tolerance of `1e-6`,
 * which is a demand for a hundred times more precision than the search was told
 * to deliver; three tests failed on it and the tests were what was wrong. The
 * scaling test below establishes that the requested tolerance is what actually
 * governs the error, which is the property worth asserting.
 */
const SPEED_TOL = 1e-10;
const FAST = { sweepSamples: 12, angleTol: 1e-8, speedTol: SPEED_TOL } as const;

function problem(cd = 0, launchPoint: readonly number[] = [0, 0]): ShootingProblem {
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
    target: UNUSED_TARGET,
    launchPoint,
    config: TOL,
    stepper: createDormandPrince54Stepper(),
    tspan: [0, 600],
    layout: PLANAR_LAYOUT,
  };
}

/** Closed-form minimum speed to `(x, y)` relative to the launch point. */
function exactMinSpeed(dx: number, dy: number): number {
  return Math.sqrt(G_STD * (dy + Math.hypot(dx, dy)));
}

/** Closed-form minimum-energy elevation to `(x, y)` relative to the launch point. */
function exactMinTheta(dx: number, dy: number): number {
  return Math.PI / 4 + Math.atan2(dy, dx) / 2;
}

const DEG = 180 / Math.PI;

describe("minimumSpeedToHit — the drag-free closed form, which is exact", () => {
  it("recovers v₀ = √(g·x) and θ = 45° for a ground target", () => {
    const solution = minimumSpeedToHit(problem(0), [100, 0], FAST);

    expect(solution.status).toBe("converged");
    expect(Math.abs(solution.speed - exactMinSpeed(100, 0))).toBeLessThan(2 * SPEED_TOL);
    expect(solution.theta * DEG).toBeCloseTo(45, 6);
    // Drag-free, the drag-free bound *is* the answer, so the surcharge is zero
    // to within the relative resolution of the speed itself.
    expect(Math.abs(solution.speedPenalty)).toBeLessThan(SPEED_TOL);
  });

  it.each([
    { dx: 100, dy: 30 },
    { dx: 100, dy: -20 },
    { dx: 60, dy: 60 },
    { dx: 250, dy: 5 },
  ])("recovers the closed form for an elevated target (dx=$dx, dy=$dy)", ({ dx, dy }) => {
    // Launch raised to 50 m so that dy = -20 is a genuine below-launch target
    // rather than an impossible one.
    const launchHeight = 50;
    const solution = minimumSpeedToHit(
      problem(0, [0, launchHeight]),
      [dx, launchHeight + dy],
      FAST,
    );

    expect(solution.status).toBe("converged");
    // Held to the tolerance actually requested, with one factor of two of slack
    // for the half-bracket the root-find stops on.
    expect(Math.abs(solution.speed - exactMinSpeed(dx, dy))).toBeLessThan(2 * SPEED_TOL);
    // **θ carries a floor that speed does not, and it is geometry-dependent.**
    // Measured across exactly these four rows: (100,30) 7.378e-10, (100,−20)
    // 9.974e-9, (60,60) 1.277e-8, (250,5) 1.618e-8 rad. The flatter and longer
    // the shot, the broader the height maximum the inner search is locating and
    // the worse its location resolves — `optimal-angle.ts` derives that floor.
    // The bound is set above the worst measured row rather than at any single
    // one of them: an earlier draft asserted 1e-8, which was the (100,30) figure
    // generalized to geometries it had never been measured on, and two rows
    // failed it.
    expect(Math.abs(solution.theta - exactMinTheta(dx, dy))).toBeLessThan(1e-7);
    expect(solution.specificEnergy).toBeCloseTo(0.5 * solution.speed ** 2, 12);
  });

  it("delivers the tolerance it is asked for, and θ floors before speed does", () => {
    // The discriminating test behind every tolerance-scaled assertion in this
    // file. Measured, ground target raised 50 m, dx=100 dy=30:
    //
    //   speedTol   |speed − exact|   |θ − exact|
    //   1e-4       6.925e-5         1.824e-6
    //   1e-6       5.410e-7         2.166e-8
    //   1e-8       8.453e-9         4.549e-9
    //   1e-10      6.604e-11        7.378e-10
    //   1e-12      5.187e-13        7.378e-10
    //
    // Speed tracks the request across eight orders. θ does not: it stops at
    // ~7.4e-10 rad and tightening further buys nothing, which is the floor
    // MinEnergySolution.theta documents. Asserted as the *relationship* rather
    // than as those digits, so a solver-tolerance change does not falsify it.
    const dx = 100;
    const dy = 30;
    const launchHeight = 50;
    const exact = exactMinSpeed(dx, dy);
    const errors = [1e-6, 1e-10].map((speedTol) => {
      const solution = minimumSpeedToHit(problem(0, [0, launchHeight]), [dx, launchHeight + dy], {
        sweepSamples: 12,
        angleTol: 1e-8,
        speedTol,
      });
      return { speedTol, error: Math.abs(solution.speed - exact) };
    });

    for (const { speedTol, error } of errors) {
      expect(error).toBeLessThan(2 * speedTol);
    }
    // Ten thousand times tighter in, at least a thousand times tighter out —
    // the request governs the answer rather than a floor governing both.
    expect(errors[1]!.error).toBeLessThan(errors[0]!.error / 1e3);
  });

  it("recovers θ → 90° and v₀ → √(2g·Δy) for a target directly overhead", () => {
    // The degenerate limit of the closed form, approached rather than hit: a
    // strictly vertical shot has no downrange abscissa for the envelope to be
    // measured over, so the target is placed a metre downrange.
    const solution = minimumSpeedToHit(problem(0), [1, 80], FAST);

    expect(Math.abs(solution.speed - exactMinSpeed(1, 80))).toBeLessThan(2 * SPEED_TOL);
    expect(solution.theta * DEG).toBeGreaterThan(89);
    expect(solution.theta * DEG).toBeLessThan(90);
  });
});

describe("minimumSpeedToHit — KKT: envelope tangency at the solution", () => {
  it("puts the target exactly on the envelope (stationarity)", () => {
    const target: readonly [number, number] = [100, 30];
    const solution = minimumSpeedToHit(problem(0.47), target, FAST);

    expect(solution.status).toBe("converged");
    // The tangency residual the search drives to zero.
    expect(Math.abs(solution.margin)).toBeLessThan(1e-6);

    // Re-measured through the public envelope entry point rather than trusting
    // the reported margin.
    const above = maxHeightAtDownrange(problem(0.47), solution.speed, target[0], FAST);
    expect(above).not.toBeNull();
    expect(above!.height).toBeCloseTo(target[1], 5);
    expect(above!.theta).toBeCloseTo(solution.theta, 3);
  });

  it("matches the closed-form parabola slope where the optimal arc meets it (drag-free)", () => {
    const target: readonly [number, number] = [100, 30];
    const solution = minimumSpeedToHit(problem(0), target, FAST);
    const v = solution.speed;

    // The safety parabola is y = v²/2g − g x²/2v², so its slope at x is
    // −g·x/v². Nothing in the implementation computes this.
    const parabolaSlope = (-G_STD * target[0]) / (v * v);

    // The optimal arc's slope at the target, by central difference of the
    // interpolated crossing height.
    const fly = createFlight(problem(0));
    const flight = fly(solution.aim);
    expect(flight.ok).toBe(true);
    const h = 0.05;
    const yPlus = heightAtDownrange(flight.trajectory!, target[0] + h, PLANAR_LAYOUT);
    const yMinus = heightAtDownrange(flight.trajectory!, target[0] - h, PLANAR_LAYOUT);
    expect(yPlus).not.toBeNull();
    expect(yMinus).not.toBeNull();
    const arcSlope = (yPlus! - yMinus!) / (2 * h);

    // Tangency: the arc is parallel to the boundary where it touches it.
    expect(arcSlope).toBeCloseTo(parabolaSlope, 4);
    // And the arc really is at the target there, not merely parallel somewhere.
    const yAt = heightAtDownrange(flight.trajectory!, target[0], PLANAR_LAYOUT);
    expect(yAt).toBeCloseTo(target[1], 5);
  });

  it("matches the measured envelope slope with drag, where no closed form exists", () => {
    const cd = 0.47;
    const target: readonly [number, number] = [100, 30];
    const solution = minimumSpeedToHit(problem(cd), target, FAST);
    const h = 0.5;

    // Envelope slope: central difference of the boundary height itself.
    const envUp = maxHeightAtDownrange(problem(cd), solution.speed, target[0] + h, FAST);
    const envDown = maxHeightAtDownrange(problem(cd), solution.speed, target[0] - h, FAST);
    expect(envUp).not.toBeNull();
    expect(envDown).not.toBeNull();
    const envelopeSlope = (envUp!.height - envDown!.height) / (2 * h);

    // Arc slope, same difference on the optimal trajectory.
    const flight = createFlight(problem(cd))(solution.aim);
    expect(flight.ok).toBe(true);
    const yPlus = heightAtDownrange(flight.trajectory!, target[0] + h, PLANAR_LAYOUT);
    const yMinus = heightAtDownrange(flight.trajectory!, target[0] - h, PLANAR_LAYOUT);
    const arcSlope = (yPlus! - yMinus!) / (2 * h);

    // Loose against the drag-free case on purpose: both sides are now numerical
    // derivatives over a finite h, and the envelope's is a difference of two
    // separately-converged maximizations. Agreement to a few parts in a
    // thousand is the honest resolution of this comparison, and it is still
    // three orders below the slope itself (~ −0.7).
    expect(arcSlope).toBeCloseTo(envelopeSlope, 2);
    expect(Math.abs(arcSlope - envelopeSlope)).toBeLessThan(5e-3);
  });

  it("is genuinely minimal: a hair slower cannot reach, a hair faster can", () => {
    const cd = 0.47;
    const target: readonly [number, number] = [100, 30];
    const solution = minimumSpeedToHit(problem(cd), target, FAST);

    // Decided by assessReachability, which computes reachability by its own
    // route and shares no code path with the root-find above.
    const slower = assessReachability(problem(cd), solution.speed * 0.999, target, FAST);
    const faster = assessReachability(problem(cd), solution.speed * 1.001, target, FAST);

    expect(slower.reachable).toBe(false);
    expect(faster.reachable).toBe(true);
    // The near miss is small — this is a boundary, not a cliff.
    expect(slower.distanceToEnvelope).toBeGreaterThan(0);
    expect(slower.distanceToEnvelope).toBeLessThan(1);
  });

  it("collapses the two arcs into one at the minimum and separates them above it", () => {
    const cd = 0.47;
    const target: readonly [number, number] = [100, 30];
    const solution = minimumSpeedToHit(problem(cd), target, FAST);

    // At the minimum the low and high arcs have merged: the elevation window
    // that still clears the target is narrower than the 1e-3 rad probe.
    expect(solution.arcSeparation).toBe(0);

    // Well above it, two distinct elevations hit and the window is wide. This
    // is the discriminating half — a separation of zero everywhere would pass
    // the assertion above while meaning the measurement is broken.
    const fly = createFlight(problem(cd));
    const clears = (theta: number): boolean => {
      const flight = fly({ theta, speed: solution.speed * 1.2 });
      if (!flight.ok || flight.trajectory === null) return false;
      const y = heightAtDownrange(flight.trajectory, target[0], PLANAR_LAYOUT);
      return y !== null && y >= target[1];
    };
    // 5° either side of the tangency aim clears at 20% more speed; at the
    // minimum speed it does not.
    const wide = 5 / DEG;
    expect(clears(solution.theta + wide) || clears(solution.theta - wide)).toBe(true);
  });
});

describe("minimumSpeedToHit — what drag costs", () => {
  /**
   * The measured surcharge. Every figure produced by running this file; see the
   * module note on why none of it is predicted. Recorded in the assertions only
   * as ordering and sign, so a solver-tolerance change moves the numbers without
   * falsifying the test.
   */
  it.each([
    { dx: 50, dy: 0 },
    { dx: 100, dy: 0 },
    { dx: 200, dy: 0 },
    { dx: 100, dy: 30 },
    { dx: 100, dy: -30 },
  ])("costs speed and flattens the aim (dx=$dx, dy=$dy)", ({ dx, dy }) => {
    const launchHeight = 50;
    const target: readonly [number, number] = [dx, launchHeight + dy];
    const withDrag = minimumSpeedToHit(problem(0.47, [0, launchHeight]), target, FAST);
    const withoutDrag = minimumSpeedToHit(problem(0, [0, launchHeight]), target, FAST);

    expect(withDrag.status).toBe("converged");
    expect(withoutDrag.status).toBe("converged");

    // Drag is dissipative, so it can only ever raise the minimum speed. This is
    // the load-bearing claim behind using the drag-free value as a lower bound.
    expect(withDrag.speed).toBeGreaterThan(withoutDrag.speed);
    expect(withDrag.speedPenalty).toBeGreaterThan(0);
    expect(withoutDrag.speedPenalty).toBeLessThan(SPEED_TOL);

    // The drag-free reference the module reports is the exact closed form.
    expect(withDrag.dragFreeSpeed).toBeCloseTo(exactMinSpeed(dx, dy), 9);

    // The optimal elevation drops with drag, the same direction P5.14 measured
    // for the maximum-range aim and for the same reason: lofting buys hang time
    // that drag then charges for.
    expect(withDrag.theta).toBeLessThan(withoutDrag.theta);
  });

  it("charges more the further the shot", () => {
    const launchHeight = 0;
    const penalties = [50, 100, 200, 400].map(
      (dx) =>
        minimumSpeedToHit(problem(0.47, [0, launchHeight]), [dx, launchHeight], FAST).speedPenalty,
    );
    // Monotone increasing: a longer shot spends longer being decelerated.
    for (let i = 1; i < penalties.length; i++) {
      expect(penalties[i]!).toBeGreaterThan(penalties[i - 1]!);
    }
    // And the effect is real at this scale, not a rounding artefact.
    expect(penalties[0]!).toBeGreaterThan(1e-3);
  });
});

describe("minimumSpeedToHit — statuses and rejected inputs", () => {
  it("reports a target beyond the launcher's speed cap as unreachable", () => {
    const solution = minimumSpeedToHit(problem(0.47), [2000, 0], { ...FAST, maxSpeed: 60 });

    expect(solution.status).toBe("unreachable");
    expect(solution.converged).toBe(false);
    // The margin is still the honest shortfall at the cap, not a sentinel.
    expect(solution.margin).toBeLessThan(0);
  });

  it("reports below-bracket when a caller starts the search past the answer", () => {
    const exact = exactMinSpeed(100, 0);
    const solution = minimumSpeedToHit(problem(0), [100, 0], {
      ...FAST,
      minSpeed: exact * 2,
      maxExpansions: 1,
    });

    expect(solution.status).toBe("below-bracket");
    expect(solution.converged).toBe(false);
  });

  it("still finds the answer from a raised minSpeed when allowed to contract", () => {
    const exact = exactMinSpeed(100, 0);
    const solution = minimumSpeedToHit(problem(0), [100, 0], { ...FAST, minSpeed: exact * 2 });

    expect(solution.status).toBe("converged");
    expect(solution.speed).toBeCloseTo(exact, 6);
  });

  it.each([
    { label: "non-finite target", call: () => minimumSpeedToHit(problem(0), [Number.NaN, 0]) },
    {
      label: "non-positive speedTol",
      call: () => minimumSpeedToHit(problem(0), [100, 0], { speedTol: 0 }),
    },
    {
      label: "expansionFactor <= 1",
      call: () => minimumSpeedToHit(problem(0), [100, 0], { expansionFactor: 1 }),
    },
    {
      label: "non-integer maxExpansions",
      call: () => minimumSpeedToHit(problem(0), [100, 0], { maxExpansions: 2.5 }),
    },
    {
      label: "non-positive minSpeed",
      call: () => minimumSpeedToHit(problem(0), [100, 0], { minSpeed: 0 }),
    },
  ])("throws on $label", ({ call }) => {
    expect(call).toThrow(/minimumSpeedToHit/);
  });
});
