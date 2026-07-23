import { describe, expect, it, vi } from "vitest";
import type { LaunchSpec } from "./launch-schema.js";
import { LaunchPanel } from "./launch-panel.js";
import { NumericControlRow } from "./numeric-control-row.js";

const SPEC: LaunchSpec = { v0: 30, theta: 45, y0: 0, omega: 0 };

describe("LaunchPanel", () => {
  it("renders one row per launchSpecSchema field, in schema order, with correctly-derived ranges/units", () => {
    const vnode = LaunchPanel({ value: SPEC, onChange: vi.fn() });

    expect(vnode.props["data-testid"]).toBe("launch-panel");
    const rows = vnode.props.children;
    expect(rows).toHaveLength(4);

    const byPath = new Map(
      rows.map((row: { props: { descriptor: { path: string } } }) => [
        row.props.descriptor.path,
        row.props.descriptor,
      ]),
    );

    expect(byPath.get("v0")).toMatchObject({ kind: "slider", min: 0, max: 150, value: 30 });
    expect(byPath.get("theta")).toMatchObject({ kind: "slider", min: 0, max: 90, value: 45 });
    expect(byPath.get("y0")).toMatchObject({ kind: "slider", min: 0, max: 100, value: 0 });
    expect(byPath.get("omega")).toMatchObject({ kind: "slider", min: -500, max: 500, value: 0 });

    expect(
      rows.map((row: { props: { descriptor: { path: string } } }) => row.props.descriptor.path),
    ).toEqual(["v0", "theta", "y0", "omega"]);
  });

  it("a row's onChange merges just that field into a new LaunchSpec, leaving the others untouched", () => {
    const onChange = vi.fn();
    const vnode = LaunchPanel({ value: SPEC, onChange });
    const rows = vnode.props.children;
    const thetaRow = rows.find(
      (row: { props: { descriptor: { path: string } } }) => row.props.descriptor.path === "theta",
    );

    thetaRow.props.onChange(60);

    expect(onChange).toHaveBeenCalledWith({ v0: 30, theta: 60, y0: 0, omega: 0 });
  });

  it("values clamp to schema ranges end-to-end through the panel (P3.19 validation criterion)", () => {
    const onChange = vi.fn();
    const panelVNode = LaunchPanel({ value: SPEC, onChange });
    const omegaRow = panelVNode.props.children.find(
      (row: { props: { descriptor: { path: string } } }) => row.props.descriptor.path === "omega",
    );

    // Render one level deeper (the actual <input> the row produces), so
    // this exercises the real commit/clamp path a rendered slider drag
    // would -- not just LaunchPanel's own field-merge logic.
    const rowVNode = NumericControlRow(omegaRow.props);
    const [, sliderInput] = rowVNode.props.children;

    // omega's range is [-500, 500]; committing far outside it must clamp
    // before the panel ever sees it, not merge a raw out-of-range value.
    sliderInput.props.onInput({ currentTarget: { value: "999999" } });

    expect(onChange).toHaveBeenCalledWith({ v0: 30, theta: 45, y0: 0, omega: 500 });
  });
});
