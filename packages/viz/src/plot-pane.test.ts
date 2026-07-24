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
  buildPlotScreenPoints,
  computeSeriesTimeRange,
  computeSeriesValueRange,
  computeSpeedAndEnergySeries,
  drawPlotPane,
  heightSeries,
  invariantResidualSeries,
  plotScreenX,
  plotScreenY,
  screenXToPlotTime,
  screenYToPlotValue,
  stepSizeSeries,
  type PlotPaneCanvas,
  type PlotPaneLayout,
  type PlotSeries,
} from "./plot-pane.js";

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;

function solveShotPut() {
  const { model, ctx, y0 } = resolveModel(SHOT_PUT);
  const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
  const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.01, maxSteps: 100_000 };
  const trajectoryRecorder = new TrajectoryRecorder();
  const invariantMonitor = new InvariantMonitor(model, ctx, stepper, "energy");
  const stepSizeRecorder = new StepSizeRecorder();
  integrate(model, ctx, y0, [0, 2], cfg, stepper, [
    trajectoryRecorder,
    invariantMonitor,
    stepSizeRecorder,
  ]);
  return {
    model,
    ctx,
    trajectory: trajectoryRecorder.trajectory,
    invariantChannel: invariantMonitor.channel,
    stepSizeTrace: stepSizeRecorder.trace,
  };
}

describe("heightSeries: matches the recorder's own Y channel (P3.29 validation criterion)", () => {
  it("is the exact same Float64Array as trajectory.channels[1], not a copy", () => {
    const { trajectory } = solveShotPut();
    const series = heightSeries(trajectory);
    expect(series.values).toBe(trajectory.channels[1]);
    expect(series.t).toBe(trajectory.t);
    expect(series.unit).toBe("m");
  });
});

describe("computeSpeedAndEnergySeries: matches independently-computed physics (P3.29 validation criterion)", () => {
  it("every row's speed/energy equals hypot(vx,vy)/mechanicalEnergy computed directly from that row's own channels", () => {
    const { model, ctx, trajectory } = solveShotPut();
    const { speed, energy } = computeSpeedAndEnergySeries(model, trajectory, ctx);

    expect(speed.t).toBe(trajectory.t);
    expect(energy.t).toBe(trajectory.t);
    expect(speed.unit).toBe("m/s");
    expect(energy.unit).toBe("J");

    const rhsScratch = new Float64Array(model.dim);
    const y = new Float64Array(model.dim);
    // Spot-check a handful of rows (start, a third through, end) against a
    // fully independent recomputation from the trajectory's own channels.
    for (const i of [0, Math.floor(trajectory.nSteps / 3), trajectory.nSteps - 1]) {
      for (let c = 0; c < trajectory.channels.length; c++) {
        y[c] = trajectory.channels[c]![i]!;
      }
      model.rhs(trajectory.t[i]!, y, rhsScratch, ctx);
      expect(speed.values[i]).toBeCloseTo(Math.hypot(y[2]!, y[3]!), 10);
      expect(energy.values[i]).toBeCloseTo(mechanicalEnergy(y, ctx), 10);
    }
  });
});

describe("invariantResidualSeries / stepSizeSeries: verbatim from their recorder outputs", () => {
  it("R_E series is InvariantMonitor's own residual channel, relabeled", () => {
    const { invariantChannel } = solveShotPut();
    const series = invariantResidualSeries(invariantChannel);

    expect(series.label).toBe("R_E");
    expect(series.t).toBe(invariantChannel.t);
    expect(series.values).toBe(invariantChannel.residual);
  });

  it("h(t) series is StepSizeRecorder's own trace, relabeled", () => {
    const { stepSizeTrace } = solveShotPut();
    const series = stepSizeSeries(stepSizeTrace);

    expect(series.label).toBe("h");
    expect(series.unit).toBe("s");
    expect(series.t).toBe(stepSizeTrace.t);
    expect(series.values).toBe(stepSizeTrace.h);
  });
});

const LAYOUT: PlotPaneLayout = { x: 10, y: 20, width: 200, height: 100 };

describe("plotScreenX/Y round-trip exactly to the original data (P3.29 validation criterion)", () => {
  it("screenXToPlotTime(plotScreenX(t)) === t and screenYToPlotValue(plotScreenY(v)) === v", () => {
    const timeRange = { min: 0, max: 2 };
    const valueRange = { min: -5, max: 30 };

    for (const t of [0, 0.3, 1, 1.7, 2]) {
      const screenX = plotScreenX(t, timeRange, LAYOUT);
      expect(screenXToPlotTime(screenX, timeRange, LAYOUT)).toBeCloseTo(t, 10);
    }
    for (const v of [-5, -1, 0, 12.5, 30]) {
      const screenY = plotScreenY(v, valueRange, LAYOUT);
      expect(screenYToPlotValue(screenY, valueRange, LAYOUT)).toBeCloseTo(v, 10);
    }
  });

  it("larger values plot at smaller screen y (up is up, matching Camera2D's convention)", () => {
    const valueRange = { min: 0, max: 10 };
    expect(plotScreenY(10, valueRange, LAYOUT)).toBeLessThan(plotScreenY(0, valueRange, LAYOUT));
  });
});

describe("computeSeriesValueRange", () => {
  it("pads a perfectly flat series instead of collapsing to a zero-height range", () => {
    const flat: PlotSeries = {
      label: "px",
      unit: "kg*m/s",
      t: new Float64Array([0, 1, 2]),
      values: new Float64Array([5, 5, 5]),
    };
    const range = computeSeriesValueRange(flat);
    expect(range.max).toBeGreaterThan(range.min);
    expect(range.min).toBeLessThan(5);
    expect(range.max).toBeGreaterThan(5);
  });
});

describe("buildPlotScreenPoints: one screen point per recorded row, no resampling (P3.29 validation criterion)", () => {
  it("produces exactly series.t.length points, and each round-trips back through its own ranges to the source data", () => {
    const { trajectory } = solveShotPut();
    const series = heightSeries(trajectory);
    const timeRange = computeSeriesTimeRange(series);
    const valueRange = computeSeriesValueRange(series);

    const points = buildPlotScreenPoints(series, LAYOUT, timeRange, valueRange);
    expect(points).toHaveLength(series.t.length);

    for (const i of [0, Math.floor(points.length / 2), points.length - 1]) {
      expect(screenXToPlotTime(points[i]!.x, timeRange, LAYOUT)).toBeCloseTo(series.t[i]!, 8);
      expect(screenYToPlotValue(points[i]!.y, valueRange, LAYOUT)).toBeCloseTo(
        series.values[i]!,
        8,
      );
    }
  });
});

class RecordingCanvas implements PlotPaneCanvas {
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

describe("drawPlotPane: axes carry correct units (P3.29 validation criterion)", () => {
  it("labels value-axis ticks and the pane title with the series' own unit, and time ticks in seconds", () => {
    const series: PlotSeries = {
      label: "y",
      unit: "m",
      t: new Float64Array([0, 0.5, 1, 1.5, 2]),
      values: new Float64Array([0, 12, 20, 12, 0]),
    };
    const canvas = new RecordingCanvas();

    drawPlotPane(canvas, series, LAYOUT);

    expect(canvas.strokeCalls).toBe(1); // one polyline stroke for the whole series
    expect(canvas.texts).toContain("y (m)"); // corner label
    expect(canvas.texts.some((t) => t.endsWith(" m"))).toBe(true); // value ticks
    expect(canvas.texts.some((t) => t.endsWith(" s"))).toBe(true); // time ticks
  });

  it("draws nothing for an empty series", () => {
    const empty: PlotSeries = {
      label: "y",
      unit: "m",
      t: new Float64Array(0),
      values: new Float64Array(0),
    };
    const canvas = new RecordingCanvas();
    drawPlotPane(canvas, empty, LAYOUT);
    expect(canvas.strokeCalls).toBe(0);
  });
});
