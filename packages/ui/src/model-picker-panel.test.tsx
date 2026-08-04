import { describe, expect, it, vi } from "vitest";
import type { InitialConditions, ModelSpec } from "@ballista/engine";
import { DEFAULT_TAU_OMEGA } from "@ballista/runtime";
import { ModelPickerPanel } from "./model-picker-panel.js";

/** JSX array children come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring the other panel tests (`environment-panel.test.tsx`, `forces-panel.test.tsx`). */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

type SelectVNode = { props: { value: string; onInput: (e: unknown) => void; children: unknown } };
type ChannelListVNode = { props: { children: unknown } };
type ChannelRowVNode = { props: { "data-testid": string; children: unknown } };
type RowVNode = { props: { descriptor: { path: string }; onChange: (v: unknown) => void } };

const BASE_MODEL: ModelSpec = { id: "planar-projectile", forceIds: ["gravity"] };
const BASE_IC: InitialConditions = { x0: 0, y0: 1, vx0: 10, vy0: 10 };

function render(model: ModelSpec, initialConditions: InitialConditions, onChange = vi.fn()) {
  const vnode = ModelPickerPanel({ model, initialConditions, onChange });
  const [select, channelList, ...paramRows] = flatChildren(vnode.props.children) as [
    SelectVNode,
    ChannelListVNode,
    ...RowVNode[],
  ];
  return {
    onChange,
    select,
    channelNames: (flatChildren(channelList.props.children) as ChannelRowVNode[]).map(
      (row) => row.props["data-testid"],
    ),
    paramRows,
  };
}

describe("ModelPickerPanel: kind select", () => {
  it("defaults to 'planar' selected when model.kind is omitted", () => {
    const { select } = render(BASE_MODEL, BASE_IC);
    expect(select.props.value).toBe("planar");
    const options = flatChildren(select.props.children) as { props: { value: string } }[];
    expect(options.map((o) => o.props.value)).toEqual(["planar", "planar-spin", "spatial"]);
  });

  it("reflects an explicit kind", () => {
    const { select } = render({ ...BASE_MODEL, kind: "spatial" }, BASE_IC);
    expect(select.props.value).toBe("spatial");
  });
});

describe("ModelPickerPanel: switching model regenerates channels/controls (P4.30 validation criterion)", () => {
  it("planar shows the 4 planar channels and no param controls", () => {
    const { channelNames, paramRows } = render(BASE_MODEL, BASE_IC);
    expect(channelNames).toEqual([
      "model-picker-channel-x",
      "model-picker-channel-y",
      "model-picker-channel-vx",
      "model-picker-channel-vy",
    ]);
    expect(paramRows).toHaveLength(0);
  });

  it("selecting planar-spin commits a fresh model.kind + tauOmega, and re-rendering with the committed value shows the omega channel plus a tauOmega control", () => {
    const { select, onChange } = render(BASE_MODEL, BASE_IC);
    select.props.onInput({ currentTarget: { value: "planar-spin" } });

    expect(onChange).toHaveBeenCalledWith({
      model: { ...BASE_MODEL, kind: "planar-spin", tauOmega: DEFAULT_TAU_OMEGA },
      initialConditions: BASE_IC,
    });

    const committed = onChange.mock.calls[0]![0] as {
      model: ModelSpec;
      initialConditions: InitialConditions;
    };
    const { channelNames, paramRows } = render(committed.model, committed.initialConditions);
    expect(channelNames).toEqual([
      "model-picker-channel-x",
      "model-picker-channel-y",
      "model-picker-channel-vx",
      "model-picker-channel-vy",
      "model-picker-channel-omega",
    ]);
    expect(paramRows).toHaveLength(1);
    expect(paramRows[0]!.props.descriptor.path).toBe("tauOmega");
  });

  it("selecting spatial commits fresh z0/vz0=0 on initialConditions, and re-rendering shows the z/vz channels plus z0/vz0 controls", () => {
    const { select, onChange } = render(BASE_MODEL, BASE_IC);
    select.props.onInput({ currentTarget: { value: "spatial" } });

    expect(onChange).toHaveBeenCalledWith({
      model: { ...BASE_MODEL, kind: "spatial" },
      initialConditions: { ...BASE_IC, z0: 0, vz0: 0 },
    });

    const committed = onChange.mock.calls[0]![0] as {
      model: ModelSpec;
      initialConditions: InitialConditions;
    };
    const { channelNames, paramRows } = render(committed.model, committed.initialConditions);
    expect(channelNames).toEqual([
      "model-picker-channel-x",
      "model-picker-channel-y",
      "model-picker-channel-z",
      "model-picker-channel-vx",
      "model-picker-channel-vy",
      "model-picker-channel-vz",
    ]);
    expect(paramRows.map((r) => r.props.descriptor.path)).toEqual(["z0", "vz0"]);
  });

  it("editing tauOmega on a planar-spin model commits an updated model, leaving initialConditions untouched", () => {
    const spinModel: ModelSpec = { ...BASE_MODEL, kind: "planar-spin", tauOmega: 12 };
    const { paramRows, onChange } = render(spinModel, BASE_IC);

    paramRows[0]!.props.onChange(30);

    expect(onChange).toHaveBeenCalledWith({
      model: { ...spinModel, tauOmega: 30 },
      initialConditions: BASE_IC,
    });
  });

  it("editing z0 on a spatial model commits an updated initialConditions, leaving model untouched", () => {
    const spatialModel: ModelSpec = { ...BASE_MODEL, kind: "spatial" };
    const spatialIc: InitialConditions = { ...BASE_IC, z0: 0, vz0: 0 };
    const { paramRows, onChange } = render(spatialModel, spatialIc);

    const z0Row = paramRows.find((r) => r.props.descriptor.path === "z0")!;
    z0Row.props.onChange(7.5);

    expect(onChange).toHaveBeenCalledWith({
      model: spatialModel,
      initialConditions: { ...spatialIc, z0: 7.5 },
    });
  });

  it("switching planar-spin -> planar drops the tauOmega control entirely", () => {
    const spinModel: ModelSpec = { ...BASE_MODEL, kind: "planar-spin", tauOmega: 12 };
    const { select, onChange } = render(spinModel, BASE_IC);
    select.props.onInput({ currentTarget: { value: "planar" } });

    const committed = onChange.mock.calls[0]![0] as {
      model: ModelSpec;
      initialConditions: InitialConditions;
    };
    expect("tauOmega" in committed.model).toBe(false);
    const { paramRows } = render(committed.model, committed.initialConditions);
    expect(paramRows).toHaveLength(0);
  });
});
