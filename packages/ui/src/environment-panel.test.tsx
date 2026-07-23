import { describe, expect, it, vi } from "vitest";
import { ISA, type EnvironmentSpec } from "@ballista/engine";
import { EnvironmentPanel } from "./environment-panel.js";

/** JSX array children (`{items.map(...)}`) come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring `projectile-panel.test.tsx`. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

const BASE_ENVIRONMENT: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: { g0: 9.80665, altitudeDependent: false },
  wind: { kind: "zero" },
};

type SelectVNode = { props: { value: string; onInput: (e: unknown) => void; children: unknown } };
type RowVNode = { props: { descriptor: { path: string }; onChange: (v: unknown) => void } };

function sections(environment: EnvironmentSpec, onChange = vi.fn()) {
  const vnode = EnvironmentPanel({ environment, onChange });
  const [gravitySection, atmosphereSection, windSection] = flatChildren(vnode.props.children) as [
    { props: { children: unknown } },
    { props: { children: unknown } },
    { props: { children: unknown } },
  ];
  return {
    onChange,
    gravity: flatChildren(gravitySection.props.children),
    atmosphere: flatChildren(atmosphereSection.props.children),
    wind: flatChildren(windSection.props.children),
  };
}

describe("EnvironmentPanel: gravity group", () => {
  it("preset select defaults to Earth for standard gravity, non-altitude-dependent", () => {
    const { gravity } = sections(BASE_ENVIRONMENT);
    const [select] = gravity as [SelectVNode];
    expect(select.props.value).toBe("earth");

    const options = flatChildren(select.props.children) as { props: { value: string } }[];
    expect(options.map((o) => o.props.value)).toEqual(["earth", "moon", "mars", "custom"]);
  });

  it("selecting Moon commits g0=1.62, leaving altitudeDependent untouched", () => {
    const { gravity, onChange } = sections(BASE_ENVIRONMENT);
    const [select] = gravity as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "moon" } });

    expect(onChange).toHaveBeenCalledWith({
      ...BASE_ENVIRONMENT,
      gravity: { g0: 1.62, altitudeDependent: false },
    });
  });

  it("selecting Custom from the preset dropdown is a no-op (no onChange)", () => {
    const { gravity, onChange } = sections(BASE_ENVIRONMENT);
    const [select] = gravity as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "custom" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a non-standard g0 shows Custom selected, and g0/altitudeDependent controls are present", () => {
    const custom: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      gravity: { g0: 4.2, altitudeDependent: true },
    };
    const { gravity } = sections(custom);
    const [select, ...rows] = gravity as [SelectVNode, ...RowVNode[]];
    expect(select.props.value).toBe("custom");

    const paths = rows.map((row) => row.props.descriptor.path);
    expect(paths).toEqual(["g0", "altitudeDependent"]);
  });

  it("editing g0 commits an updated gravity spec", () => {
    const { gravity, onChange } = sections(BASE_ENVIRONMENT);
    const [, g0Row] = gravity as [SelectVNode, RowVNode];

    g0Row.props.onChange(3.71);

    expect(onChange).toHaveBeenCalledWith({
      ...BASE_ENVIRONMENT,
      gravity: { g0: 3.71, altitudeDependent: false },
    });
  });

  it("toggling altitudeDependent (checkbox row) commits an updated gravity spec", () => {
    const { gravity, onChange } = sections(BASE_ENVIRONMENT);
    const [, , altitudeRow] = gravity as [SelectVNode, RowVNode, RowVNode];

    altitudeRow.props.onChange(true);

    expect(onChange).toHaveBeenCalledWith({
      ...BASE_ENVIRONMENT,
      gravity: { g0: 9.80665, altitudeDependent: true },
    });
  });
});

describe("EnvironmentPanel: atmosphere group", () => {
  it("constant atmosphere shows no param controls beyond the kind select", () => {
    const { atmosphere } = sections(BASE_ENVIRONMENT);
    expect(atmosphere).toHaveLength(1);
  });

  it("switching to exponential seeds ISA-default params and regenerates controls", () => {
    const { atmosphere, onChange } = sections(BASE_ENVIRONMENT);
    const [select] = atmosphere as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "exponential" } });

    expect(onChange).toHaveBeenCalledWith({
      ...BASE_ENVIRONMENT,
      atmosphere: {
        kind: "exponential",
        rho0: ISA.rho0,
        T0: ISA.T0,
        p0: ISA.p0,
        scaleHeight: ISA.scaleHeight,
      },
    });
  });

  it("exponential atmosphere shows rho0/T0/p0/scaleHeight controls", () => {
    const exponentialEnv: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      atmosphere: { kind: "exponential", rho0: 1.1, T0: 280, p0: 90000, scaleHeight: 8000 },
    };
    const { atmosphere } = sections(exponentialEnv);
    const [, ...rows] = atmosphere as [SelectVNode, ...RowVNode[]];
    expect(rows.map((r) => r.props.descriptor.path)).toEqual(["rho0", "T0", "p0", "scaleHeight"]);
  });

  it("editing scaleHeight commits an updated exponential atmosphere spec", () => {
    const exponentialEnv: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      atmosphere: { kind: "exponential", rho0: 1.1, T0: 280, p0: 90000, scaleHeight: 8000 },
    };
    const { atmosphere, onChange } = sections(exponentialEnv);
    const [, , , , scaleHeightRow] = atmosphere as [
      SelectVNode,
      RowVNode,
      RowVNode,
      RowVNode,
      RowVNode,
    ];

    scaleHeightRow.props.onChange(9000);

    expect(onChange).toHaveBeenCalledWith({
      ...exponentialEnv,
      atmosphere: { ...exponentialEnv.atmosphere, scaleHeight: 9000 },
    });
  });

  it("switching back to constant drops every exponential param", () => {
    const exponentialEnv: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      atmosphere: { kind: "exponential", rho0: 1.1, T0: 280, p0: 90000, scaleHeight: 8000 },
    };
    const { atmosphere, onChange } = sections(exponentialEnv);
    const [select] = atmosphere as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "constant" } });

    expect(onChange).toHaveBeenCalledWith({ ...exponentialEnv, atmosphere: { kind: "constant" } });
  });
});

describe("EnvironmentPanel: wind group -- model swap regenerates its param controls (P3.21 validation criterion)", () => {
  it("zero wind shows no param controls beyond the kind select", () => {
    const { wind } = sections(BASE_ENVIRONMENT);
    expect(wind).toHaveLength(1);
    const [select] = wind as [SelectVNode];
    expect(select.props.value).toBe("zero");
  });

  it("switching zero -> uniform commits a fresh uniform spec and the rendered params change to wx/wy", () => {
    const { wind, onChange } = sections(BASE_ENVIRONMENT);
    const [select] = wind as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "uniform" } });
    const committed = onChange.mock.calls[0]![0] as EnvironmentSpec;
    expect(committed.wind).toEqual({ kind: "uniform", wx: 5, wy: 0 });

    const { wind: uniformWind } = sections(committed);
    const [, ...rows] = uniformWind as [SelectVNode, ...RowVNode[]];
    expect(rows.map((r) => r.props.descriptor.path)).toEqual(["wx", "wy"]);
  });

  it("switching uniform -> gaussian-vortex changes the rendered params from wx/wy to circulation/coreRadius/centerX/centerY", () => {
    const uniformEnv: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      wind: { kind: "uniform", wx: 10, wy: 0 },
    };
    const { wind, onChange } = sections(uniformEnv);
    const [select] = wind as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "gaussian-vortex" } });
    const committed = onChange.mock.calls[0]![0] as EnvironmentSpec;
    expect(committed.wind).toEqual({
      kind: "gaussian-vortex",
      circulation: 50,
      coreRadius: 5,
      centerX: 0,
      centerY: 0,
    });

    const { wind: vortexWind } = sections(committed);
    const [, ...rows] = vortexWind as [SelectVNode, ...RowVNode[]];
    expect(rows.map((r) => r.props.descriptor.path)).toEqual([
      "circulation",
      "coreRadius",
      "centerX",
      "centerY",
    ]);
  });

  it("editing a log-profile field commits an updated wind spec", () => {
    const logProfileEnv: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      wind: { kind: "log-profile", frictionVelocity: 0.4, roughnessLength: 0.01, wy: 0 },
    };
    const { wind, onChange } = sections(logProfileEnv);
    const [, frictionVelocityRow] = wind as [SelectVNode, RowVNode];

    frictionVelocityRow.props.onChange(1.2);

    expect(onChange).toHaveBeenCalledWith({
      ...logProfileEnv,
      wind: { ...logProfileEnv.wind, frictionVelocity: 1.2 },
    });
  });

  it("gridded wind shows no param controls (array grid data isn't slider-representable)", () => {
    const griddedEnv: EnvironmentSpec = {
      ...BASE_ENVIRONMENT,
      wind: {
        kind: "gridded",
        grid: { x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 2, wx: [0, 0, 0, 0], wy: [0, 0, 0, 0] },
      },
    };
    const { wind } = sections(griddedEnv);
    expect(wind).toHaveLength(1);
  });

  it("an unrecognized dropdown value is ignored -- no onChange call", () => {
    const { wind, onChange } = sections(BASE_ENVIRONMENT);
    const [select] = wind as [SelectVNode];

    select.props.onInput({ currentTarget: { value: "not-a-real-kind" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
