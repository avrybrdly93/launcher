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
  buildPhasePlotFigure,
  buildPlotlyFigure,
  buildWorkPrecisionFigure,
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
