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
import {
  PLANAR_LAYOUT,
  SPATIAL_LAYOUT,
  apex,
  apexHeight,
  apexTime,
  impactSpeed,
  missDistance,
  range,
  timeOfFlight,
} from "./observables.js";

/**
 * P5.01's validation criterion is "drag-free observables match analytics to
 * 1e-9", so the reference values here are closed forms, never a previous run
 * of this same code. For a launch from height $y_0$ at speed $v_0$ and angle
 * $\theta$ with $C_d = 0$:
 *
 * - apex height $= y_0 + v_{y0}^2 / 2g$ at $t = v_{y0}/g$;
 * - time of flight $= (v_{y0} + \sqrt{v_{y0}^2 + 2 g y_0})/g$ (the positive
 *   root of $y_0 + v_{y0}t - \tfrac12 g t^2 = 0$);
 * - range $= v_{x0}\,t_{\text{flight}}$;
 * - impact speed $= \sqrt{v_0^2 + 2 g y_0}$ — which is energy conservation,
 *   $\tfrac12 v_{\text{imp}}^2 = \tfrac12 v_0^2 + g y_0$, and therefore an
 *   *independent* check rather than an algebraic restatement of the flight
 *   time above.
 *
 * The $y_0 \neq 0$ cases matter: at $y_0 = 0$ the flight time collapses to
 * $2v_{y0}/g$ and the apex sits exactly halfway, so a sign error or a
 * factor-of-two in either formula can cancel itself. A raised launch breaks
 * that symmetry.
 */
interface DragFreeCase {
  readonly v0: number;
  readonly thetaDeg: number;
  readonly y0: number;
}

function analytic(c: DragFreeCase): {
  apexHeight: number;
  apexTime: number;
  timeOfFlight: number;
  range: number;
  impactSpeed: number;
} {
  const theta = (c.thetaDeg * Math.PI) / 180;
  const vx0 = c.v0 * Math.cos(theta);
  const vy0 = c.v0 * Math.sin(theta);
  const tFlight = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G_STD * c.y0)) / G_STD;
  return {
    apexHeight: c.y0 + (vy0 * vy0) / (2 * G_STD),
    apexTime: vy0 / G_STD,
    timeOfFlight: tFlight,
    range: vx0 * tFlight,
    impactSpeed: Math.sqrt(c.v0 * c.v0 + 2 * G_STD * c.y0),
  };
}

/**
 * Integrates a drag-free launch to ground impact and returns the recorded
 * trajectory. `ConstantCd(0)` with only a `GravityForce` wired makes the
 * dynamics exactly $\ddot y = -g$, $\ddot x = 0$; the tight tolerances are
 * there so the *terminal event localization* — which is what the impact
 * observables actually read — lands well inside 1e-9, since this test is
 * measuring the observables and not the solver.
 */
function simulateDragFree(c: DragFreeCase): Trajectory {
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

  const theta = (c.thetaDeg * Math.PI) / 180;
  const y0 = new Float64Array([0, c.y0, c.v0 * Math.cos(theta), c.v0 * Math.sin(theta)]);
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
  expect(report.tFinal).toBeLessThan(200);
  return recorder.trajectory;
}

/** Relative error, falling back to absolute when the reference is ~0. */
function relErr(actual: number, expected: number): number {
  const scale = Math.abs(expected);
  return scale > 1e-12 ? Math.abs(actual - expected) / scale : Math.abs(actual - expected);
}

const CASES: readonly (DragFreeCase & { readonly name: string })[] = [
  { name: "45° from the ground (max-range case)", v0: 50, thetaDeg: 45, y0: 0 },
  { name: "low 20° arc", v0: 80, thetaDeg: 20, y0: 0 },
  { name: "steep 70° arc", v0: 30, thetaDeg: 70, y0: 0 },
  { name: "raised launch, 35° from 100 m", v0: 60, thetaDeg: 35, y0: 100 },
  { name: "raised launch, 55° from 12.5 m", v0: 25, thetaDeg: 55, y0: 12.5 },
];

describe("P5.01 observables vs drag-free analytics (§9.1, 1e-9 criterion)", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const traj = simulateDragFree(c);
      const want = analytic(c);

      it("time of flight matches (v_y0 + sqrt(v_y0^2 + 2 g y_0))/g", () => {
        expect(relErr(timeOfFlight(traj), want.timeOfFlight)).toBeLessThan(1e-9);
      });

      it("range matches v_x0 * t_flight", () => {
        expect(relErr(range(traj, PLANAR_LAYOUT), want.range)).toBeLessThan(1e-9);
      });

      it("apex height matches y_0 + v_y0^2/2g", () => {
        expect(relErr(apexHeight(traj, PLANAR_LAYOUT), want.apexHeight)).toBeLessThan(1e-9);
      });

      it("apex time matches v_y0/g", () => {
        expect(relErr(apexTime(traj, PLANAR_LAYOUT), want.apexTime)).toBeLessThan(1e-9);
      });

      it("impact speed matches sqrt(v_0^2 + 2 g y_0) (energy conservation)", () => {
        expect(relErr(impactSpeed(traj, PLANAR_LAYOUT), want.impactSpeed)).toBeLessThan(1e-9);
      });

      it("miss distance to the analytic impact point is ~0, and to a displaced point is the displacement", () => {
        const impactPoint = [want.range, 0] as const;
        expect(missDistance(traj, impactPoint, PLANAR_LAYOUT)).toBeLessThan(1e-9 * want.range);

        // Offsetting a known-good target by a known vector must move the miss
        // by exactly that vector's length — this is what catches an
        // observable that returns a constant, or one that silently drops the
        // vertical component.
        const offset = [3, 4] as const;
        const displaced = [impactPoint[0] + offset[0], impactPoint[1] + offset[1]];
        expect(missDistance(traj, displaced, PLANAR_LAYOUT)).toBeCloseTo(5, 8);
      });
    });
  }
});

/**
 * The apex refinement is the one observable that does real numerical work, so
 * it gets its own tests: that it beats the row-wise maximum it replaces, and
 * that the degenerate arcs which have no interior $v_y$ crossing still return
 * a sensible answer instead of falling off the end of the scan.
 */
describe("P5.01 apex refinement (§4.9 Hermite)", () => {
  it("beats the raw row-wise maximum by orders of magnitude at a coarse step", () => {
    // A deliberately loose tolerance so the recorded rows are far apart and
    // the apex lands nowhere near a step boundary.
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
    const stepper = createDormandPrince54Stepper();
    const recorder = new TrajectoryRecorder();
    const theta = Math.PI / 4;

    integrate(
      model,
      ctx,
      new Float64Array([0, 0, 50 * Math.cos(theta), 50 * Math.sin(theta)]),
      [0, 200],
      { stepper: stepper.info.id, h: 1.5, rtol: 1e-3, atol: 1e-3, maxSteps: 10_000 },
      stepper,
      [recorder],
    );
    const traj = recorder.trajectory;

    const yColumn = traj.channels[1]!;
    let rowwiseMax = -Infinity;
    for (let i = 0; i < traj.nSteps; i++) rowwiseMax = Math.max(rowwiseMax, yColumn[i]!);

    const exact = (50 * Math.sin(theta)) ** 2 / (2 * G_STD);
    const refinedErr = Math.abs(apexHeight(traj, PLANAR_LAYOUT) - exact);
    const rowwiseErr = Math.abs(rowwiseMax - exact);

    // Guard against a vacuous pass: if the coarse run happened to place a row
    // on the apex, the row-wise error would already be tiny and "refined
    // beats row-wise" would prove nothing.
    expect(rowwiseErr).toBeGreaterThan(1e-6);
    expect(refinedErr).toBeLessThan(rowwiseErr / 1e3);
  });

  it("returns the launch point for a purely descending arc (no interior crossing)", () => {
    // Fabricated rows rather than a solve: the point is the branch, and a
    // hand-built trajectory pins the expected answer exactly.
    const traj: Trajectory = {
      nSteps: 3,
      t: new Float64Array([0, 1, 2]),
      channels: [
        new Float64Array([0, 10, 20]),
        new Float64Array([100, 90, 60]),
        new Float64Array([10, 10, 10]),
        new Float64Array([-5, -15, -25]),
      ],
    };
    expect(apex(traj, PLANAR_LAYOUT)).toEqual({ t: 0, height: 100 });
  });

  it("returns the final row for an arc still climbing when the solve ends", () => {
    const traj: Trajectory = {
      nSteps: 3,
      t: new Float64Array([0, 1, 2]),
      channels: [
        new Float64Array([0, 10, 20]),
        new Float64Array([0, 20, 30]),
        new Float64Array([10, 10, 10]),
        new Float64Array([25, 15, 5]),
      ],
    };
    expect(apex(traj, PLANAR_LAYOUT)).toEqual({ t: 2, height: 30 });
  });

  it("finds the highest apex across a multi-arc (bouncing) trajectory, not the first", () => {
    // Two arcs whose vertical velocity crosses zero downward twice; the
    // second arc is the taller one, so a first-crossing-only scan fails here.
    const traj: Trajectory = {
      nSteps: 5,
      t: new Float64Array([0, 1, 2, 3, 4]),
      channels: [
        new Float64Array([0, 1, 2, 3, 4]),
        new Float64Array([0, 5, 0, 9, 0]),
        new Float64Array([1, 1, 1, 1, 1]),
        new Float64Array([10, -10, 18, -18, 5]),
      ],
    };
    expect(apex(traj, PLANAR_LAYOUT).height).toBeGreaterThan(9);
    expect(apex(traj, PLANAR_LAYOUT).t).toBeGreaterThan(2);
  });
});

describe("P5.01 observable guard rails", () => {
  const planar: Trajectory = {
    nSteps: 2,
    t: new Float64Array([0, 1]),
    channels: [
      new Float64Array([0, 10]),
      new Float64Array([0, 0]),
      new Float64Array([10, 10]),
      new Float64Array([5, -5]),
    ],
  };

  it("throws rather than returning NaN when the layout names a channel the trajectory lacks", () => {
    expect(() => range(planar, SPATIAL_LAYOUT)).toThrow(
      /spans 6 channel\(s\), but the trajectory has only 4/,
    );
  });

  it("throws when the miss-distance target has the wrong dimension", () => {
    expect(() => missDistance(planar, [1, 2, 3], PLANAR_LAYOUT)).toThrow(/3 component/);
  });

  it("throws on an empty trajectory", () => {
    const empty: Trajectory = { nSteps: 0, t: new Float64Array(0), channels: [] };
    expect(() => timeOfFlight(empty)).toThrow(/at least 1/);
  });

  it("measures time of flight relative to t_0, not as an absolute clock reading", () => {
    const shifted: Trajectory = { ...planar, t: new Float64Array([1000, 1001]) };
    expect(timeOfFlight(shifted)).toBe(1);
  });

  it("reports range as a ground-track distance in 3D, not merely the downrange coordinate", () => {
    // 3-4-5 displacement in the horizontal (x, z) plane with the vertical
    // component excluded: a range that ignored the lateral deflection would
    // report 3, and one that included the 12 m of drop would report 13.
    const spatial: Trajectory = {
      nSteps: 2,
      t: new Float64Array([0, 1]),
      channels: [
        new Float64Array([0, 3]),
        new Float64Array([12, 0]),
        new Float64Array([0, 4]),
        new Float64Array([3, 3]),
        new Float64Array([-12, -12]),
        new Float64Array([4, 4]),
      ],
    };
    expect(range(spatial, SPATIAL_LAYOUT)).toBeCloseTo(5, 12);
    expect(missDistance(spatial, [3, 0, 4], SPATIAL_LAYOUT)).toBeCloseTo(0, 12);
  });
});
