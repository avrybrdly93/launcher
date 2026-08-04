import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS, type ScenarioSpec } from "@ballista/engine";
import { resolveModel } from "@ballista/runtime";
import { ModelPicker } from "./model-picker.js";

/** JSX array children come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring the other panel tests. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

type SelectVNode = { props: { value: string; onInput: (e: unknown) => void; children: unknown } };
type OptionVNode = { props: { value: string } };

const SCENARIO: ScenarioSpec = PRESET_SCENARIOS[0]!;

describe("ModelPicker", () => {
  it("offers exactly the three registered model options", () => {
    const vnode = ModelPicker({ scenario: SCENARIO, onChange: vi.fn() });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];
    const options = flatChildren(select.props.children) as OptionVNode[];

    expect(options.map((o) => o.props.value)).toEqual([
      "planar-projectile",
      "planar-projectile-spin",
      "spatial-projectile",
    ]);
  });

  it("select's current value is the scenario's current model id", () => {
    const vnode = ModelPicker({
      scenario: { ...SCENARIO, model: { ...SCENARIO.model, id: "spatial-projectile" } },
      onChange: vi.fn(),
    });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];
    expect(select.props.value).toBe("spatial-projectile");
  });

  it("an unrecognized dropdown value is ignored -- no onChange call", () => {
    const onChange = vi.fn();
    const vnode = ModelPicker({ scenario: SCENARIO, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "not-a-real-model" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selecting a different model commits a spec with only model.id changed", () => {
    const onChange = vi.fn();
    const vnode = ModelPicker({ scenario: SCENARIO, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "planar-projectile-spin" } });

    expect(onChange).toHaveBeenCalledWith({
      ...SCENARIO,
      model: { ...SCENARIO.model, id: "planar-projectile-spin" },
    });
  });

  it("this task's validation criterion end-to-end: switching model regenerates channels/controls", () => {
    const onChange = vi.fn();
    const vnode = ModelPicker({ scenario: SCENARIO, onChange });
    const [select] = flatChildren(vnode.props.children) as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "spatial-projectile" } });
    const committed = onChange.mock.calls[0]![0] as ScenarioSpec;

    const before = resolveModel(SCENARIO);
    const after = resolveModel(committed);
    expect(after.model.channels).not.toEqual(before.model.channels);
    expect(after.model.dim).toBe(6);
    expect(after.y0.length).toBe(6);
  });
});
