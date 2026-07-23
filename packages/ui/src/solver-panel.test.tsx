import { describe, expect, it, vi } from "vitest";
import type { SolverConfigSpec } from "@ballista/engine";
import { SolverPanel } from "./solver-panel.js";

/** JSX array children come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring the other panel tests. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

type SelectVNode = { props: { value: string; onInput: (e: unknown) => void; children: unknown } };
type OptGroupVNode = { type: string; props: { label: string; children: unknown } };
type OptionVNode = { props: { value: string } };
type RowVNode = {
  props: {
    descriptor?: { path: string };
    onChange?: (v: unknown) => void;
    "data-testid"?: string;
  };
};

/** A row is either a `NumericControlRow` (carries `descriptor`) or the controller's hand-rolled `<select>` row (carries only `data-testid="control-<path>"`) -- this reads either shape's field path uniformly. */
function rowPath(row: RowVNode): string {
  return row.props.descriptor?.path ?? row.props["data-testid"]!.replace("control-", "");
}

const FIXED_SOLVER: SolverConfigSpec = { stepper: "classical-rk4", h: 0.01, maxSteps: 1000 };
const ADAPTIVE_SOLVER: SolverConfigSpec = {
  stepper: "dopri5",
  rtol: 1e-6,
  atol: 1e-6,
  controller: "I",
  maxSteps: 1000,
};

describe("SolverPanel: grouped method dropdown", () => {
  it("groups options into Fixed-step and Adaptive optgroups", () => {
    const vnode = SolverPanel({ solver: FIXED_SOLVER, onChange: vi.fn() });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];
    const optgroups = flatChildren(select.props.children) as OptGroupVNode[];

    expect(optgroups.map((g) => g.type)).toEqual(["optgroup", "optgroup"]);
    expect(optgroups.map((g) => g.props.label)).toEqual(["Fixed-step", "Adaptive"]);

    const fixedOptions = flatChildren(optgroups[0]!.props.children) as OptionVNode[];
    expect(fixedOptions.map((o) => o.props.value)).toEqual([
      "explicit-euler",
      "midpoint-rk2",
      "heun-rk2",
      "classical-rk4",
    ]);

    const adaptiveOptions = flatChildren(optgroups[1]!.props.children) as OptionVNode[];
    expect(adaptiveOptions.map((o) => o.props.value)).toEqual(["bogacki-shampine-32", "dopri5"]);
  });

  it("select's current value is the current stepper id", () => {
    const vnode = SolverPanel({ solver: ADAPTIVE_SOLVER, onChange: vi.fn() });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];
    expect(select.props.value).toBe("dopri5");
  });

  it("an unrecognized dropdown value is ignored -- no onChange call", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: FIXED_SOLVER, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "not-a-real-stepper" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SolverPanel: invalid combos (h with adaptive) prevented by schema (P3.23 validation criterion)", () => {
  it("a fixed stepper renders only the h control, never rtol/atol/controller", () => {
    const vnode = SolverPanel({ solver: FIXED_SOLVER, onChange: vi.fn() });
    const [, ...rows] = flatChildren(vnode.props.children) as [SelectVNode, ...RowVNode[]];

    expect(rows.map((r) => rowPath(r))).toEqual(["h"]);
  });

  it("an adaptive stepper renders only rtol/atol/controller, never h", () => {
    const vnode = SolverPanel({ solver: ADAPTIVE_SOLVER, onChange: vi.fn() });
    const [, ...rows] = flatChildren(vnode.props.children) as [SelectVNode, ...RowVNode[]];

    expect(rows.map((r) => rowPath(r))).toEqual(["rtol", "atol", "controller"]);
  });

  it("switching from a fixed to an adaptive stepper commits a spec with rtol/atol/controller and no h", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: FIXED_SOLVER, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "dopri5" } });

    const committed = onChange.mock.calls[0]![0] as SolverConfigSpec;
    expect(committed.stepper).toBe("dopri5");
    expect("h" in committed).toBe(false);
    expect(committed.rtol).toBeGreaterThan(0);
    expect(committed.atol).toBeGreaterThan(0);
    expect(committed.controller).toBe("I");

    // The newly committed spec, rendered fresh, shows only the adaptive controls.
    const { rows } = (() => {
      const nextVNode = SolverPanel({ solver: committed, onChange: vi.fn() });
      const [, ...r] = flatChildren(nextVNode.props.children) as [SelectVNode, ...RowVNode[]];
      return { rows: r };
    })();
    expect(rows.map((r) => rowPath(r))).toEqual(["rtol", "atol", "controller"]);
  });

  it("switching from an adaptive to a fixed stepper commits a spec with h and no rtol/atol/controller", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: ADAPTIVE_SOLVER, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "explicit-euler" } });

    const committed = onChange.mock.calls[0]![0] as SolverConfigSpec;
    expect(committed.stepper).toBe("explicit-euler");
    expect(committed.h).toBeGreaterThan(0);
    expect("rtol" in committed).toBe(false);
    expect("atol" in committed).toBe(false);
    expect("controller" in committed).toBe(false);
  });

  it("switching between two fixed steppers keeps editing the same h control", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: FIXED_SOLVER, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "explicit-euler" } });

    expect(onChange).toHaveBeenCalledWith({
      stepper: "explicit-euler",
      h: FIXED_SOLVER.h,
      maxSteps: FIXED_SOLVER.maxSteps,
    });
  });
});

describe("SolverPanel: editing fields", () => {
  it("editing h commits an updated fixed spec", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: FIXED_SOLVER, onChange });
    const [, hRow] = flatChildren(vnode.props.children) as [SelectVNode, RowVNode];

    hRow.props.onChange!(0.05);
    expect(onChange).toHaveBeenCalledWith({ ...FIXED_SOLVER, h: 0.05 });
  });

  it("editing rtol commits an updated adaptive spec", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: ADAPTIVE_SOLVER, onChange });
    const [, rtolRow] = flatChildren(vnode.props.children) as [SelectVNode, RowVNode];

    rtolRow.props.onChange!(1e-8);
    expect(onChange).toHaveBeenCalledWith({ ...ADAPTIVE_SOLVER, rtol: 1e-8 });
  });

  it("changing the controller select commits an updated adaptive spec", () => {
    const onChange = vi.fn();
    const vnode = SolverPanel({ solver: ADAPTIVE_SOLVER, onChange });
    const [, , , controllerRow] = flatChildren(vnode.props.children) as [
      SelectVNode,
      RowVNode,
      RowVNode,
      { props: { children: unknown } },
    ];
    const [, controllerSelect] = flatChildren(controllerRow.props.children) as [
      unknown,
      { props: { onInput: (e: unknown) => void } },
    ];

    controllerSelect.props.onInput({ currentTarget: { value: "PI" } });
    expect(onChange).toHaveBeenCalledWith({ ...ADAPTIVE_SOLVER, controller: "PI" });
  });
});
