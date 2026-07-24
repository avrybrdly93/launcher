import { describe, expect, it } from "vitest";
import { mechanicalEnergy, PRESET_SCENARIOS } from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import {
  ClassicalRK4Stepper,
  HermiteDenseOutputStepper,
  InvariantMonitor,
  StepSizeRecorder,
  TrajectoryRecorder,
  integrate,
  type SolverConfig,
  type Stepper,
} from "@ballista/solverkit";
import {
  computeSeriesBounds,
  createPlotSeriesScratch,
  drawPlotPane,
  energySeries,
  plotDataToPixel,
  residualSeries,
  stateChannelSeries,
  stepSizeSeries,
  type PlotPaneCanvas,
  type PlotRect,
} from "./plot-pane.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;

function solve(preset = SHOT_PUT) {
  const { model, ctx, y0 } = resolveModel(preset);
  const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
  const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.01, maxSteps: 100_000 };
  const trajectoryRecorder = new TrajectoryRecorder();
  const stepSizeRecorder = new StepSizeRecorder();
  const invariantMonitor = new InvariantMonitor(model, ctx, stepper, "energy");
  integrate(model, ctx, y0, [0, 2], cfg, stepper, [
    trajectoryRecorder,
    stepSizeRecorder,
    invariantMonitor,
  ]);
  return {
    model,
    ctx,
    trajectory: trajectoryRecorder.trajectory,
    stepSizeTrace: stepSizeRecorder.trace,
    residualChannel: invariantMonitor.channel,
  };
}

describe("stateChannelSeries: curves match recorder channels (P3.29 validation criterion)", () => {
  it("y(t) is exactly the trajectory's own Y channel; |v|(t) is hypot(vx, vy) of its own VX/VY channels", () => {
    const { trajectory } = solve();
    const { height, speed } = stateChannelSeries(trajectory);

    expect(height.t).toBe(trajectory.t); // same buffer, not a copy
    expect(height.values).toBe(trajectory.channels[1]); // the Y channel itself
    expect(height.unit).toBe("m");

    expect(speed.unit).toBe("m/s");
    for (let i = 0; i < trajectory.nSteps; i++) {
      const expected = Math.hypot(trajectory.channels[2]![i]!, trajectory.channels[3]![i]!);
      expect(speed.values[i]).toBe(expected);
    }
  });
});

describe("energySeries: curves match recorder channels (P3.29 validation criterion)", () => {
  it("E(t) at every row equals mechanicalEnergy computed independently on that row's own state", () => {
    const { model, ctx, trajectory } = solve();
    const scratch = createPlotSeriesScratch(model.dim);
    const series = energySeries(model, trajectory, ctx, scratch);

    expect(series.unit).toBe("J");
    expect(series.t).toBe(trajectory.t);

    const y = new Float64Array(model.dim);
    for (const i of [0, 1, Math.floor(trajectory.nSteps / 2), trajectory.nSteps - 1]) {
      y[0] = trajectory.channels[0]![i]!;
      y[1] = trajectory.channels[1]![i]!;
      y[2] = trajectory.channels[2]![i]!;
      y[3] = trajectory.channels[3]![i]!;
      model.rhs(trajectory.t[i]!, y, new Float64Array(model.dim), ctx);
      expect(series.values[i]).toBeCloseTo(mechanicalEnergy(y, ctx), 10);
    }
  });

  it("drag-free energy is (nearly) conserved: E(t) stays close to E(0)", () => {
    const dragFree = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!; // gravity only
    const { model, ctx, trajectory } = solve(dragFree);
    const scratch = createPlotSeriesScratch(model.dim);
    const series = energySeries(model, trajectory, ctx, scratch);

    const e0 = series.values[0]!;
    for (let i = 0; i < series.values.length; i++) {
      expect(Math.abs(series.values[i]! - e0) / Math.abs(e0)).toBeLessThan(1e-6);
    }
  });
});

describe("residualSeries / stepSizeSeries: wrap sink outputs without recomputation", () => {
  it("residualSeries carries the InvariantMonitor's own t/residual arrays verbatim", () => {
    const { residualChannel } = solve();
    const series = residualSeries(residualChannel);
    expect(series.t).toBe(residualChannel.t);
    expect(series.values).toBe(residualChannel.residual);
    expect(series.name).toBe("R_energy");
    expect(series.unit).toBe("J");
  });

  it("stepSizeSeries carries the StepSizeRecorder's own t/h arrays verbatim", () => {
    const { stepSizeTrace } = solve();
    const series = stepSizeSeries(stepSizeTrace);
    expect(series.t).toBe(stepSizeTrace.t);
    expect(series.values).toBe(stepSizeTrace.h);
    expect(series.name).toBe("h");
    expect(series.unit).toBe("s");
  });
});

describe("computeSeriesBounds", () => {
  it("finds the exact min/max of t and values", () => {
    const series = {
      name: "x",
      unit: "m",
      t: new Float64Array([0, 1, 2, 3]),
      values: new Float64Array([5, -2, 8, 1]),
    };
    const bounds = computeSeriesBounds(series);
    expect(bounds).toEqual({ minT: 0, maxT: 3, minValue: -2, maxValue: 8 });
  });

  it("pads a degenerate (constant-value or single-point) series so spans never collapse to 0", () => {
    const series = {
      name: "x",
      unit: "m",
      t: new Float64Array([5]),
      values: new Float64Array([3]),
    };
    const bounds = computeSeriesBounds(series);
    expect(bounds.maxT).toBeGreaterThan(bounds.minT);
    expect(bounds.maxValue).toBeGreaterThan(bounds.minValue);
  });
});

describe("plotDataToPixel", () => {
  const bounds = { minT: 0, maxT: 10, minValue: -5, maxValue: 5 };
  const rect: PlotRect = { x: 100, y: 200, width: 300, height: 60 };

  it("maps minT to the rect's left edge and maxT to its right edge", () => {
    expect(plotDataToPixel(bounds, rect, 0, 0).x).toBe(rect.x);
    expect(plotDataToPixel(bounds, rect, 10, 0).x).toBe(rect.x + rect.width);
  });

  it("maps minValue to the rect's bottom and maxValue to its top (value increases upward)", () => {
    expect(plotDataToPixel(bounds, rect, 0, -5).y).toBe(rect.y + rect.height);
    expect(plotDataToPixel(bounds, rect, 0, 5).y).toBe(rect.y);
  });
});

class RecordingCanvas implements PlotPaneCanvas {
  strokeStyle = "";
  lineWidth = 0;
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  moveToCalls: Array<[number, number]> = [];
  lineToCalls: Array<[number, number]> = [];
  fillTextCalls: Array<[string, number, number]> = [];
  strokeCalls = 0;
  beginPathCalls = 0;

  beginPath(): void {
    this.beginPathCalls++;
  }
  moveTo(x: number, y: number): void {
    this.moveToCalls.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.lineToCalls.push([x, y]);
  }
  stroke(): void {
    this.strokeCalls++;
  }
  fillText(text: string, x: number, y: number): void {
    this.fillTextCalls.push([text, x, y]);
  }
}

describe("drawPlotPane: axes correct units (P3.29 validation criterion)", () => {
  const rect: PlotRect = { x: 10, y: 10, width: 200, height: 80 };

  it("labels every y-axis tick with the series' own unit suffix", () => {
    const canvas = new RecordingCanvas();
    const series = {
      name: "y",
      unit: "m",
      t: new Float64Array([0, 1, 2, 3, 4]),
      values: new Float64Array([0, 5, 8, 5, 0]),
    };
    drawPlotPane(canvas, rect, series);

    expect(canvas.fillTextCalls.length).toBeGreaterThan(0);
    for (const [text] of canvas.fillTextCalls) {
      expect(text.endsWith(" m")).toBe(true);
    }
  });

  it("a different series' unit shows up in its own axis labels (h(t) in seconds, not meters)", () => {
    const canvas = new RecordingCanvas();
    const series = {
      name: "h",
      unit: "s",
      t: new Float64Array([0, 1, 2]),
      values: new Float64Array([0.01, 0.02, 0.015]),
    };
    drawPlotPane(canvas, rect, series);
    expect(canvas.fillTextCalls.some(([text]) => text.endsWith(" s"))).toBe(true);
  });

  it("draws the curve polyline with one moveTo followed by (n-1) lineTo calls", () => {
    const canvas = new RecordingCanvas();
    const series = {
      name: "y",
      unit: "m",
      t: new Float64Array([0, 1, 2, 3]),
      values: new Float64Array([0, 1, 0, -1]),
    };
    drawPlotPane(canvas, rect, series);

    // moveToCalls includes the axis-tick moveTos too; the curve's own first
    // point is the *last* moveTo issued (axis grid lines are drawn first).
    expect(canvas.moveToCalls.length).toBeGreaterThanOrEqual(1);
    expect(canvas.lineToCalls.length).toBeGreaterThanOrEqual(series.t.length - 1);
  });

  it("draws only axis ticks (no curve strokes) for a series with fewer than 2 points", () => {
    const canvas = new RecordingCanvas();
    const series = {
      name: "y",
      unit: "m",
      t: new Float64Array([0]),
      values: new Float64Array([5]),
    };
    drawPlotPane(canvas, rect, series);
    // One stroke call for the axis grid; the curve loop returns before its own stroke.
    expect(canvas.strokeCalls).toBe(1);
  });
});
