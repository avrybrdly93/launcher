import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { KNOWN_FORCE_IDS, resolveModel } from "@ballista/runtime";
import {
  ClassicalRK4Stepper,
  HermiteDenseOutputStepper,
  TrajectoryRecorder,
  integrate,
  type SolverConfig,
  type Stepper,
} from "@ballista/solverkit";
import { createForceGlyphScratch, forceGlyphsAtPlayhead, type ForceGlyphSet } from "@ballista/viz";
import { ForcesPanel } from "./forces-panel.js";

/** JSX array children come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring the other panel tests. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

type RowVNode = {
  props: {
    children: [
      { props: { children: [{ props: { checked: boolean; onChange: () => void } }, string] } },
      { props: { children: string } },
    ];
  };
};

const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;

describe("ForcesPanel: structure", () => {
  it("renders one row per known force id, in registry order", () => {
    const vnode = ForcesPanel({ forceIds: ["gravity"], glyphSet: undefined, onChange: vi.fn() });
    const rows = flatChildren(vnode.props.children) as RowVNode[];
    expect(rows).toHaveLength(KNOWN_FORCE_IDS.length);
  });

  it("a wired force's checkbox is checked; an unwired one is not", () => {
    const vnode = ForcesPanel({
      forceIds: ["gravity", "buoyancy"],
      glyphSet: undefined,
      onChange: vi.fn(),
    });
    const rows = flatChildren(vnode.props.children) as RowVNode[];
    const byId = Object.fromEntries(KNOWN_FORCE_IDS.map((id, i) => [id, rows[i]!]));

    expect(byId.gravity!.props.children[0].props.children[0].props.checked).toBe(true);
    expect(byId.buoyancy!.props.children[0].props.children[0].props.checked).toBe(true);
    expect(byId["drag-quadratic"]!.props.children[0].props.children[0].props.checked).toBe(false);
  });

  it("a badge with no glyph set shows a blank placeholder", () => {
    const vnode = ForcesPanel({ forceIds: ["gravity"], glyphSet: undefined, onChange: vi.fn() });
    const rows = flatChildren(vnode.props.children) as RowVNode[];
    const gravityRow = rows[KNOWN_FORCE_IDS.indexOf("gravity")]!;
    expect(gravityRow.props.children[1].props.children).toBe("—");
  });
});

describe("ForcesPanel: toggles", () => {
  it("unchecking a wired force commits forceIds without it", () => {
    const onChange = vi.fn();
    const vnode = ForcesPanel({
      forceIds: ["gravity", "buoyancy"],
      glyphSet: undefined,
      onChange,
    });
    const rows = flatChildren(vnode.props.children) as RowVNode[];
    const buoyancyRow = rows[KNOWN_FORCE_IDS.indexOf("buoyancy")]!;

    buoyancyRow.props.children[0].props.children[0].props.onChange();
    expect(onChange).toHaveBeenCalledWith(["gravity"]);
  });

  it("checking an unwired force commits forceIds with it appended", () => {
    const onChange = vi.fn();
    const vnode = ForcesPanel({ forceIds: ["gravity"], glyphSet: undefined, onChange });
    const rows = flatChildren(vnode.props.children) as RowVNode[];
    const buoyancyRow = rows[KNOWN_FORCE_IDS.indexOf("buoyancy")]!;

    buoyancyRow.props.children[0].props.children[0].props.onChange();
    expect(onChange).toHaveBeenCalledWith(["gravity", "buoyancy"]);
  });

  it("unchecking the last remaining force is a no-op", () => {
    const onChange = vi.fn();
    const vnode = ForcesPanel({ forceIds: ["gravity"], glyphSet: undefined, onChange });
    const rows = flatChildren(vnode.props.children) as RowVNode[];
    const gravityRow = rows[KNOWN_FORCE_IDS.indexOf("gravity")]!;

    gravityRow.props.children[0].props.children[0].props.onChange();
    expect(onChange).toHaveBeenCalledWith(["gravity"]);
  });
});

describe("ForcesPanel: badge equals |F| channel at playhead (P3.22 validation criterion)", () => {
  it("a live glyphSet's magnitude is exactly what its badge renders", () => {
    const { model, ctx, y0, forces } = resolveModel(GOLF_DRIVE);
    const stepper: Stepper = new HermiteDenseOutputStepper(new ClassicalRK4Stepper());
    const cfg: SolverConfig = { stepper: "classical-rk4", h: 0.01, maxSteps: 100_000 };
    const recorder = new TrajectoryRecorder();
    integrate(model, ctx, y0, [0, 2], cfg, stepper, [recorder]);
    const trajectory = recorder.trajectory;

    const playbackTime = trajectory.t[Math.floor(trajectory.nSteps / 3)]!;
    const scratch = createForceGlyphScratch(model.dim);
    const glyphSet: ForceGlyphSet = forceGlyphsAtPlayhead(
      model,
      forces,
      trajectory,
      playbackTime,
      ctx,
      scratch,
    );

    const vnode = ForcesPanel({ forceIds: GOLF_DRIVE.model.forceIds, glyphSet, onChange: vi.fn() });
    const rows = flatChildren(vnode.props.children) as RowVNode[];

    for (const glyph of glyphSet.forces) {
      const row = rows[KNOWN_FORCE_IDS.indexOf(glyph.id)]!;
      const badgeText = row.props.children[1].props.children;
      expect(badgeText).toBe(`${glyph.magnitude.toPrecision(3)} N`);
    }
  });
});
