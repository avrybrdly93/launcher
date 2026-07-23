import { describe, expect, it, vi } from "vitest";
import { PROJECTILE_ASSETS, type ProjectileSpec } from "@ballista/engine";
import { CUSTOM_PROJECTILE_ID } from "./projectile-panel-logic.js";
import { ProjectilePanel } from "./projectile-panel.js";

const GOLF_BALL = PROJECTILE_ASSETS.find((p) => p.id === "golf-ball")!;
const SMOOTH_SPHERE = PROJECTILE_ASSETS.find((p) => p.dragModel.kind === "tabulated-reynolds")!;

/** JSX array children (`{items.map(...)}`) come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring what a real render pass does. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

describe("ProjectilePanel: preset dropdown", () => {
  it("lists every catalog preset plus a trailing Custom option, current value = the current projectile's id", () => {
    const vnode = ProjectilePanel({ projectile: GOLF_BALL, onChange: vi.fn() });
    const [select] = flatChildren(vnode.props.children) as [
      { type: string; props: { value: string; children: unknown } },
    ];

    expect(select.type).toBe("select");
    expect(select.props.value).toBe("golf-ball");

    const options = flatChildren(select.props.children) as { props: { value: string } }[];
    const optionIds = options.map((option) => option.props.value);
    expect(optionIds).toEqual([...PROJECTILE_ASSETS.map((p) => p.id), CUSTOM_PROJECTILE_ID]);
  });

  it("switching preset re-solves: selecting a different preset id commits that preset's full spec (P3.20 validation criterion)", () => {
    const onChange = vi.fn();
    const vnode = ProjectilePanel({ projectile: GOLF_BALL, onChange });
    const [select] = flatChildren(vnode.props.children) as [
      { props: { onInput: (e: unknown) => void } },
    ];

    select.props.onInput({ currentTarget: { value: "baseball" } });

    const baseball = PROJECTILE_ASSETS.find((p) => p.id === "baseball")!;
    expect(onChange).toHaveBeenCalledWith(baseball);
  });

  it("re-selecting the same preset still commits a (structurally equal but distinct) spec, so re-solving isn't skipped", () => {
    const onChange = vi.fn();
    const vnode = ProjectilePanel({ projectile: GOLF_BALL, onChange });
    const [select] = flatChildren(vnode.props.children) as [
      { props: { onInput: (e: unknown) => void } },
    ];

    select.props.onInput({ currentTarget: { value: "golf-ball" } });

    expect(onChange).toHaveBeenCalledWith(GOLF_BALL);
  });

  it("an unrecognized dropdown value (e.g. a stale option) is ignored -- no onChange call", () => {
    const onChange = vi.fn();
    const vnode = ProjectilePanel({ projectile: GOLF_BALL, onChange });
    const [select] = flatChildren(vnode.props.children) as [
      { props: { onInput: (e: unknown) => void } },
    ];

    select.props.onInput({ currentTarget: { value: "not-a-real-preset" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ProjectilePanel: custom params, custom persists in draft (P3.20 validation criterion)", () => {
  it("selecting Custom seeds mass/radius/dragModel from the current preset, not arbitrary defaults", () => {
    const onChange = vi.fn();
    const vnode = ProjectilePanel({ projectile: GOLF_BALL, onChange });
    const [select] = flatChildren(vnode.props.children) as [
      { props: { onInput: (e: unknown) => void } },
    ];

    select.props.onInput({ currentTarget: { value: CUSTOM_PROJECTILE_ID } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CUSTOM_PROJECTILE_ID,
        mass: GOLF_BALL.mass,
        radius: GOLF_BALL.radius,
        dragModel: GOLF_BALL.dragModel,
      }),
    );
  });

  it("while already custom, no preset dropdown selection is required to show mass/radius controls", () => {
    const custom: ProjectileSpec = { ...GOLF_BALL, id: CUSTOM_PROJECTILE_ID, name: "Custom" };
    const vnode = ProjectilePanel({ projectile: custom, onChange: vi.fn() });
    const [, ...rows] = flatChildren(vnode.props.children) as {
      props: { descriptor: { path: string } };
    }[];

    const paths = rows.map((row) => row.props.descriptor.path);
    expect(paths).toContain("mass");
    expect(paths).toContain("radius");
    expect(paths).toContain("dragCoefficient"); // golf-ball's dragModel is constant
  });

  it("editing mass while custom commits an updated spec that is still custom (does not fall back to a preset)", () => {
    const custom: ProjectileSpec = { ...GOLF_BALL, id: CUSTOM_PROJECTILE_ID, name: "Custom" };
    const onChange = vi.fn();
    const vnode = ProjectilePanel({ projectile: custom, onChange });
    const children = flatChildren(vnode.props.children) as {
      props: { descriptor?: { path: string }; onChange: (v: number) => void };
    }[];
    const massRow = children.find((child) => child.props.descriptor?.path === "mass")!;

    massRow.props.onChange(0.05);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: CUSTOM_PROJECTILE_ID, mass: 0.05 }),
    );
  });

  it("editing the drag coefficient while custom rewrites dragModel to {kind: constant, cd: next}", () => {
    const custom: ProjectileSpec = { ...GOLF_BALL, id: CUSTOM_PROJECTILE_ID, name: "Custom" };
    const onChange = vi.fn();
    const vnode = ProjectilePanel({ projectile: custom, onChange });
    const children = flatChildren(vnode.props.children) as {
      props: { descriptor?: { path: string }; onChange: (v: number) => void };
    }[];
    const dragRow = children.find((child) => child.props.descriptor?.path === "dragCoefficient")!;

    dragRow.props.onChange(0.42);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dragModel: { kind: "constant", cd: 0.42 } }),
    );
  });

  it("no dragCoefficient control appears for a custom spec whose drag model is tabulated-Reynolds", () => {
    const custom: ProjectileSpec = { ...SMOOTH_SPHERE, id: CUSTOM_PROJECTILE_ID, name: "Custom" };
    const vnode = ProjectilePanel({ projectile: custom, onChange: vi.fn() });
    const [, ...rows] = flatChildren(vnode.props.children) as {
      props: { descriptor: { path: string } };
    }[];

    const paths = rows.map((row) => row.props.descriptor.path);
    expect(paths).toEqual(["mass", "radius"]);
  });

  it("no custom controls appear at all for a non-custom (preset) projectile", () => {
    const vnode = ProjectilePanel({ projectile: GOLF_BALL, onChange: vi.fn() });
    expect(flatChildren(vnode.props.children)).toHaveLength(1); // just the <select>
  });
});
