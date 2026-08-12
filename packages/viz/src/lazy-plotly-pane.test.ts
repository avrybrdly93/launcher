import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import {
  ClassicalRK4Stepper,
  TrajectoryRecorder,
  integrate,
  type SolverConfig,
  type Stepper,
  type WorkPrecisionCurve,
} from "@ballista/solverkit";
import {
  buildConvergenceFigure,
  buildEnergyDriftFigure,
  buildPhasePlotFigure,
  buildPlotlyFigure,
  buildStabilityRegionFigure,
  buildWorkPrecisionFigure,
  buildNewtonTraceFigure,
  type ConvergenceCurve,
  type EnergyDriftCurve,
  type NewtonTraceCurve,
  type TrajectoryChannelSpec,
} from "./lazy-plotly-pane.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;

function solveShotPut() {
  const { model, ctx, y0 } = resolveModel(SHOT_PUT);
  const stepper: Stepper = new ClassicalRK4Stepper();
  const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.01, maxSteps: 100_000 };
  const trajectoryRecorder = new TrajectoryRecorder();
  integrate(model, ctx, y0, [0, 2], cfg, stepper, [trajectoryRecorder]);
  return trajectoryRecorder.trajectory;
}

describe("buildPlotlyFigure: pure data shaping, no Plotly import needed", () => {
  it("maps traces to scatter/lines+markers data and axis titles/types to layout", () => {
    const { data, layout } = buildPlotlyFigure({
      title: "Example",
      traces: [{ name: "a", x: [1, 2, 3], y: [4, 5, 6] }],
      xAxis: { title: "x (s)", type: "log" },
      yAxis: { title: "y (m)" },
    });

    expect(data).toEqual([
      { name: "a", x: [1, 2, 3], y: [4, 5, 6], mode: "lines+markers", type: "scatter" },
    ]);
    expect(layout).toMatchObject({
      title: "Example",
      xaxis: { title: "x (s)", type: "log" },
      yaxis: { title: "y (m)", type: "linear" },
    });
  });

  it("omits the layout title entirely when spec has none", () => {
    const { layout } = buildPlotlyFigure({
      traces: [],
      xAxis: { title: "x" },
      yAxis: { title: "y" },
    });
    expect(layout).not.toHaveProperty("title");
  });
});

describe("buildWorkPrecisionFigure (P3.30 exploratory pane)", () => {
  it("builds one log-log (nRHS, error) trace per method", () => {
    const curves: readonly WorkPrecisionCurve[] = [
      {
        method: "explicit-euler",
        points: [
          { h: 0.1, nRHS: 10, error: 1e-1 },
          { h: 0.05, nRHS: 20, error: 5e-2 },
        ],
      },
      {
        method: "classical-rk4",
        points: [
          { h: 0.1, nRHS: 40, error: 1e-6 },
          { h: 0.05, nRHS: 80, error: 1e-8 },
        ],
      },
    ];

    const spec = buildWorkPrecisionFigure(curves);

    expect(spec.xAxis).toEqual({ title: "cost (rhs evaluations)", type: "log" });
    expect(spec.yAxis).toEqual({ title: "global error", type: "log" });
    expect(spec.traces).toEqual([
      { name: "explicit-euler", x: [10, 20], y: [1e-1, 5e-2] },
      { name: "classical-rk4", x: [40, 80], y: [1e-6, 1e-8] },
    ]);
  });
});

describe("buildConvergenceFigure (P3.42)", () => {
  it("builds one log-log (h, error) trace per method, using measureConvergence's own samples verbatim", () => {
    const curves: readonly ConvergenceCurve[] = [
      { method: "explicit-euler", hs: [0.1, 0.05, 0.025], errors: [1e-1, 5e-2, 2.5e-2] },
      { method: "classical-rk4", hs: [0.1, 0.05, 0.025], errors: [1e-4, 6.25e-6, 3.9e-7] },
    ];

    const spec = buildConvergenceFigure(curves);

    expect(spec.xAxis).toEqual({ title: "step size h (s)", type: "log" });
    expect(spec.yAxis).toEqual({ title: "global error", type: "log" });
    expect(spec.traces).toEqual([
      { name: "explicit-euler", x: [0.1, 0.05, 0.025], y: [1e-1, 5e-2, 2.5e-2] },
      { name: "classical-rk4", x: [0.1, 0.05, 0.025], y: [1e-4, 6.25e-6, 3.9e-7] },
    ]);
  });
});

describe("buildNewtonTraceFigure (P5.19)", () => {
  it("plots ‖F‖ on a log axis against a linear iteration index", () => {
    // Linear x is the deliberate difference from the log-log figures above:
    // quadratic convergence is a steepening curve against an iteration *count*,
    // and a log x-axis would flatten the feature the plot exists to show.
    const curves: readonly NewtonTraceCurve[] = [
      {
        label: "drag-free",
        points: [
          { iteration: 0, merit: 66.16 },
          { iteration: 1, merit: 3.042 },
          { iteration: 2, merit: 5.472e-3 },
          { iteration: 3, merit: 1.782e-8 },
        ],
      },
    ];

    const spec = buildNewtonTraceFigure(curves);

    expect(spec.xAxis).toEqual({ title: "Newton iteration k" });
    expect(spec.yAxis).toEqual({ title: "‖F‖ (m)", type: "log" });
    expect(spec.traces).toEqual([
      { name: "drag-free", x: [0, 1, 2, 3], y: [66.16, 3.042, 5.472e-3, 1.782e-8] },
    ]);
  });

  it("keeps each solve's own iteration indices rather than re-numbering from zero", () => {
    const spec = buildNewtonTraceFigure([
      {
        label: "resumed",
        points: [
          { iteration: 4, merit: 1e-2 },
          { iteration: 5, merit: 1e-5 },
        ],
      },
    ]);

    expect(spec.traces[0]!.x).toEqual([4, 5]);
  });

  it("drops a residual a log axis cannot place, without shifting the surviving points", () => {
    // ‖F‖ = 0 is what an exact hit reports. Clamping it would draw a residual
    // the solve never reached; dropping it leaves iteration 2 at x = 2.
    const spec = buildNewtonTraceFigure([
      {
        label: "exact",
        points: [
          { iteration: 0, merit: 1 },
          { iteration: 1, merit: 1e-4 },
          { iteration: 2, merit: 0 },
        ],
      },
    ]);

    expect(spec.traces[0]).toEqual({ name: "exact", x: [0, 1], y: [1, 1e-4] });
  });

  it("builds one trace per solve", () => {
    const spec = buildNewtonTraceFigure([
      { label: "a", points: [{ iteration: 0, merit: 1 }] },
      { label: "b", points: [{ iteration: 0, merit: 2 }] },
    ]);

    expect(spec.traces.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("survives a solve with no plottable points at all", () => {
    const spec = buildNewtonTraceFigure([{ label: "empty", points: [] }]);

    expect(spec.traces).toEqual([{ name: "empty", x: [], y: [] }]);
  });
});

describe("buildStabilityRegionFigure (P3.43)", () => {
  it("builds a contour trace at the |R(z)|=1 level plus a scatter trace of the given eigenvalue points", () => {
    const spec = buildStabilityRegionFigure(
      4,
      "Classical RK4",
      [-3, 1],
      [-3, 3],
      [
        { re: -0.5, im: 0.1 },
        { re: -1.2, im: -0.2 },
      ],
    );

    expect(spec.traces).toHaveLength(2);
    const [contour, eigenvalues] = spec.traces;
    expect(contour).toMatchObject({
      kind: "contour",
      name: "|R(z)| = 1",
      contourStart: 1,
      contourEnd: 1,
      contourSize: 0,
    });
    expect(contour!.x.length).toBeGreaterThan(1);
    expect(contour!.y.length).toBeGreaterThan(1);
    expect((contour as { z: readonly (readonly number[])[] }).z).toHaveLength(contour!.y.length);
    expect((contour as { z: readonly (readonly number[])[] }).z[0]).toHaveLength(contour!.x.length);

    expect(eigenvalues).toEqual({ name: "h·λ (trajectory)", x: [-0.5, -1.2], y: [0.1, -0.2] });
    expect(spec.xAxis).toEqual({ title: "Re(z)" });
    expect(spec.yAxis).toEqual({ title: "Im(z)" });
  });

  it("mirrors buildPlotlyFigure's contour trace into a Plotly contour data object", () => {
    const spec = buildStabilityRegionFigure(1, "Explicit Euler", [-2, 1], [-1.5, 1.5], []);
    const { data } = buildPlotlyFigure(spec);
    expect(data[0]).toMatchObject({
      type: "contour",
      contours: { start: 1, end: 1, size: 0, coloring: "lines" },
    });
    expect(data[1]).toMatchObject({ type: "scatter", mode: "lines+markers" });
  });
});

describe("buildEnergyDriftFigure (P3.44)", () => {
  it("builds one linear-linear (t, relativeEnergyError) trace per method, using the study's own samples verbatim", () => {
    const curves: readonly EnergyDriftCurve[] = [
      {
        method: "Explicit Euler",
        t: new Float64Array([0, 1, 2]),
        relativeEnergyError: new Float64Array([0, 1e-3, 2e-3]),
      },
      {
        method: "Velocity Verlet",
        t: new Float64Array([0, 1, 2]),
        relativeEnergyError: new Float64Array([0, -1e-14, 3e-14]),
      },
    ];

    const spec = buildEnergyDriftFigure(curves);

    expect(spec.title).toBe("Energy drift");
    expect(spec.xAxis).toEqual({ title: "t (s)" });
    expect(spec.yAxis).toEqual({ title: "E(t)/E(0) − 1" });
    expect(spec.traces).toEqual([
      { name: "Explicit Euler", x: [0, 1, 2], y: [0, 1e-3, 2e-3] },
      { name: "Velocity Verlet", x: [0, 1, 2], y: [0, -1e-14, 3e-14] },
    ]);
  });
});

describe("buildPhasePlotFigure (P3.30 exploratory pane)", () => {
  it("reads the two requested channels straight off the trajectory -- matches recorder channels exactly", () => {
    const trajectory = solveShotPut();
    const yChannel: TrajectoryChannelSpec = { index: 1, label: "y", unit: "m" };
    const vyChannel: TrajectoryChannelSpec = { index: 3, label: "v_y", unit: "m/s" };

    const spec = buildPhasePlotFigure(trajectory, yChannel, vyChannel);

    expect(spec.title).toBe("v_y vs y");
    expect(spec.traces).toHaveLength(1);
    expect(spec.traces[0]!.x).toEqual(Array.from(trajectory.channels[1]!));
    expect(spec.traces[0]!.y).toEqual(Array.from(trajectory.channels[3]!));
    expect(spec.xAxis).toEqual({ title: "y (m)" });
    expect(spec.yAxis).toEqual({ title: "v_y (m/s)" });
  });
});
