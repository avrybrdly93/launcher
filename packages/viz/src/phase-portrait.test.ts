import { describe, expect, it } from "vitest";
import {
  createPendulumModel,
  createPlanarProjectileModel,
  PRESET_SCENARIOS,
  type EvalContext,
  type Model,
} from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import {
  ExplicitEulerStepper,
  TrajectoryRecorder,
  VerletStepper,
  integrate,
  type SolverConfig,
  type Stepper,
  type Trajectory,
} from "@ballista/solverkit";
import {
  areaGrowthRatio,
  buildPhaseScreenPoints,
  computePhaseAxisRange,
  cycleAreas,
  defaultPhasePairIndex,
  drawPhasePortrait,
  phasePairIndices,
  phasePortraitSeries,
  signedPolygonArea,
  type PhasePortraitCanvas,
  type PhasePortraitSeries,
} from "./phase-portrait.js";
import { screenXToPlotTime, screenYToPlotValue, type PlotPaneLayout } from "./plot-pane.js";

const LAYOUT: PlotPaneLayout = { x: 10, y: 20, width: 200, height: 100 };

/** L and g chosen so the small-amplitude period is ~2.006 s, i.e. a run of a few seconds covers several laps. */
const PENDULUM_L = 1;
const PENDULUM_G = 9.81;

/**
 * The pendulum's `rhs` reads no `EvalContext` at all (P4.31: no forces, no
 * environment sampling), so an empty object is the honest stand-in here --
 * the same one `verlet-stepper.test.ts` uses for its own context-free models.
 */
const NO_CONTEXT = {} as EvalContext;

function solvePendulum(stepper: Stepper, h: number, tEnd: number): Trajectory {
  const model = createPendulumModel(PENDULUM_L, PENDULUM_G);
  const recorder = new TrajectoryRecorder();
  const cfg: SolverConfig = { stepper: stepper.info.id, h, maxSteps: 10_000_000 };
  integrate(model, NO_CONTEXT, new Float64Array([0.5, 0]), [0, tEnd], cfg, stepper, [recorder]);
  return recorder.trajectory;
}

describe("phasePortraitSeries: axes are recorder channels, selected via model.partitions", () => {
  it("plots the pendulum's single (theta, thetadot) pair, labeled from the model's own channels", () => {
    const model = createPendulumModel(PENDULUM_L, PENDULUM_G);
    const trajectory = solvePendulum(new VerletStepper("velocity"), 0.005, 2);

    const series = phasePortraitSeries(model, trajectory);

    expect(series.qLabel).toBe("theta");
    expect(series.qUnit).toBe("rad");
    expect(series.pLabel).toBe("thetadot");
    expect(series.pUnit).toBe("rad/s");
    // Verbatim channel references, not copies: nothing is re-derived.
    expect(series.q).toBe(trajectory.channels[0]);
    expect(series.p).toBe(trajectory.channels[1]);
  });

  it("defaults a projectile model to the (y, v_y) pair, per P4.32's framing", () => {
    const scenario = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
    const { model, ctx, y0 } = resolveModel(scenario);
    const recorder = new TrajectoryRecorder();
    const stepper = new VerletStepper("velocity");
    integrate(
      model,
      ctx,
      y0,
      [0, 1],
      { stepper: stepper.info.id, h: 0.01, maxSteps: 100_000 },
      stepper,
      [recorder],
    );

    const series = phasePortraitSeries(model, recorder.trajectory);

    expect(defaultPhasePairIndex(model)).toBe(1);
    expect(series.qLabel).toBe("y");
    expect(series.pLabel).toBe("vy");
  });

  it("pairs 0 for a one-pair model and 1 for a multi-pair one", () => {
    expect(defaultPhasePairIndex(createPendulumModel(PENDULUM_L, PENDULUM_G))).toBe(0);
    expect(phasePairIndices(createPendulumModel(PENDULUM_L, PENDULUM_G))).toEqual({
      qIndex: 0,
      pIndex: 1,
    });
  });

  it("honors an explicit pair index (x vs v_x on a planar projectile)", () => {
    // Partitions are a property of the channel layout, not of which forces act.
    const model = createPlanarProjectileModel([]);
    expect(phasePairIndices(model, 0)).toEqual({ qIndex: 0, pIndex: 2 });
    expect(phasePairIndices(model, 1)).toEqual({ qIndex: 1, pIndex: 3 });
  });

  it("throws descriptively for a model with no partitions and for an out-of-range pair", () => {
    const partitionless = { dim: 2, channels: [], rhs: () => {} } as unknown as Model;
    expect(() => phasePairIndices(partitionless)).toThrow(/no partitions/);
    expect(() => phasePairIndices(createPendulumModel(PENDULUM_L, PENDULUM_G), 3)).toThrow(
      /out of range/,
    );
  });
});

describe("signedPolygonArea", () => {
  it("measures the unit square counter-clockwise as +1", () => {
    const q = new Float64Array([0, 1, 1, 0]);
    const p = new Float64Array([0, 0, 1, 1]);
    expect(signedPolygonArea(q, p)).toBeCloseTo(1, 12);
  });

  it("flips sign with traversal direction", () => {
    const q = new Float64Array([0, 0, 1, 1]);
    const p = new Float64Array([0, 1, 1, 0]);
    expect(signedPolygonArea(q, p)).toBeCloseTo(-1, 12);
  });

  it("encloses nothing with fewer than three points", () => {
    expect(signedPolygonArea(new Float64Array([0, 1]), new Float64Array([0, 1]))).toBe(0);
    expect(signedPolygonArea(new Float64Array(), new Float64Array())).toBe(0);
  });
});

describe("cycleAreas", () => {
  it("reports pi*r^2 per lap for an analytic circle traversed twice", () => {
    const r = 2;
    const perLap = 720;
    const n = 2 * perLap + 1;
    const q = new Float64Array(n);
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / perLap;
      q[i] = r * Math.cos(angle);
      p[i] = r * Math.sin(angle);
    }
    const series: PhasePortraitSeries = {
      qLabel: "q",
      qUnit: "",
      pLabel: "p",
      pUnit: "",
      q,
      p,
    };

    const areas = cycleAreas(series);

    expect(areas.length).toBe(2);
    for (const area of areas) {
      // Polygonal approximation of a circle, so slightly under pi*r^2.
      expect(area).toBeCloseTo(Math.PI * r * r, 3);
    }
    expect(areaGrowthRatio(series)).toBeCloseTo(1, 6);
  });

  it("returns no laps (and a growth ratio of 1) for a run too short to close one", () => {
    const series: PhasePortraitSeries = {
      qLabel: "q",
      qUnit: "",
      pLabel: "p",
      pUnit: "",
      q: new Float64Array([1, 0.9, 0.7]),
      p: new Float64Array([0, 0.4, 0.7]),
    };
    expect(cycleAreas(series)).toEqual([]);
    expect(areaGrowthRatio(series)).toBe(1);
  });
});

/**
 * P4.32's validation criterion, as an assertion rather than an eyeball
 * check of a picture: same conservative model, same initial state, same h,
 * same span -- only the integrator differs.
 *
 * The pendulum is conservative (no drag, no damping, no dissipative path at
 * all), which is the precondition for using the symplectic Verlet stepper
 * here; the explicit-Euler comparison is the standard non-symplectic
 * reference it is being contrasted against.
 */
describe("Euler spiral vs Verlet closed orbit (P4.32 validation criterion)", () => {
  const H = 0.01;
  const T_END = 16; // ~8 pendulum periods at L=1, g=9.81

  it("explicit Euler's orbit area grows lap over lap (outward spiral)", () => {
    const model = createPendulumModel(PENDULUM_L, PENDULUM_G);
    const series = phasePortraitSeries(model, solvePendulum(new ExplicitEulerStepper(), H, T_END));

    const areas = cycleAreas(series);

    expect(areas.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]!).toBeGreaterThan(areas[i - 1]!);
    }
    expect(areaGrowthRatio(series)).toBeGreaterThan(1.5);
  });

  it("Verlet's orbit closes on itself: area flat to within 1% over the same run", () => {
    const model = createPendulumModel(PENDULUM_L, PENDULUM_G);
    const series = phasePortraitSeries(
      model,
      solvePendulum(new VerletStepper("velocity"), H, T_END),
    );

    const areas = cycleAreas(series);

    expect(areas.length).toBeGreaterThanOrEqual(4);
    expect(areaGrowthRatio(series)).toBeGreaterThan(0.99);
    expect(areaGrowthRatio(series)).toBeLessThan(1.01);
  });

  it("separates the two integrators by an order of magnitude on the same metric", () => {
    const model = createPendulumModel(PENDULUM_L, PENDULUM_G);
    const eulerDrift = Math.abs(
      areaGrowthRatio(
        phasePortraitSeries(model, solvePendulum(new ExplicitEulerStepper(), H, T_END)),
      ) - 1,
    );
    const verletDrift = Math.abs(
      areaGrowthRatio(
        phasePortraitSeries(model, solvePendulum(new VerletStepper("velocity"), H, T_END)),
      ) - 1,
    );

    expect(eulerDrift).toBeGreaterThan(10 * verletDrift);
  });
});

describe("buildPhaseScreenPoints", () => {
  it("round-trips through plot-pane's own inverses with no distortion", () => {
    const series: PhasePortraitSeries = {
      qLabel: "theta",
      qUnit: "rad",
      pLabel: "thetadot",
      pUnit: "rad/s",
      q: new Float64Array([-0.5, 0, 0.5]),
      p: new Float64Array([0, 1.5, 0]),
    };
    const qRange = computePhaseAxisRange(series.q);
    const pRange = computePhaseAxisRange(series.p);

    const points = buildPhaseScreenPoints(series, LAYOUT, qRange, pRange);

    expect(points.length).toBe(3);
    for (let i = 0; i < points.length; i++) {
      expect(screenXToPlotTime(points[i]!.x, qRange, LAYOUT)).toBeCloseTo(series.q[i]!, 10);
      expect(screenYToPlotValue(points[i]!.y, pRange, LAYOUT)).toBeCloseTo(series.p[i]!, 10);
    }
  });

  it("pads a degenerate axis instead of dividing by a zero span", () => {
    expect(computePhaseAxisRange(new Float64Array([3, 3, 3]))).toEqual({ min: 2.85, max: 3.15 });
    expect(computePhaseAxisRange(new Float64Array([0, 0]))).toEqual({ min: -1, max: 1 });
    expect(computePhaseAxisRange(new Float64Array())).toEqual({ min: 0, max: 1 });
  });
});

class RecordingCanvas implements PhasePortraitCanvas {
  strokeStyle = "";
  lineWidth = 0;
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  strokeCalls = 0;
  texts: string[] = [];
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {
    this.strokeCalls++;
  }
  fillText(text: string): void {
    this.texts.push(text);
  }
}

describe("drawPhasePortrait", () => {
  it("strokes one polyline and labels both axes in their own units", () => {
    const model = createPendulumModel(PENDULUM_L, PENDULUM_G);
    const series = phasePortraitSeries(
      model,
      solvePendulum(new VerletStepper("velocity"), 0.005, 2),
    );
    const canvas = new RecordingCanvas();

    drawPhasePortrait(canvas, series, LAYOUT);

    expect(canvas.strokeCalls).toBe(1);
    expect(canvas.texts).toContain("theta-thetadot"); // corner label
    expect(canvas.texts.some((t) => t.endsWith(" rad"))).toBe(true); // q-axis ticks
    expect(canvas.texts.some((t) => t.endsWith(" rad/s"))).toBe(true); // p-axis ticks
    // Unlike drawPlotPane, the horizontal axis is a state channel, not time.
    expect(canvas.texts.some((t) => t.endsWith(" s"))).toBe(false);
  });

  it("draws no polyline for an empty series", () => {
    const canvas = new RecordingCanvas();
    drawPhasePortrait(
      canvas,
      {
        qLabel: "q",
        qUnit: "",
        pLabel: "p",
        pUnit: "",
        q: new Float64Array(),
        p: new Float64Array(),
      },
      LAYOUT,
    );
    expect(canvas.strokeCalls).toBe(0);
  });
});
