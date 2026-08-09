import { PRESET_SCENARIOS } from "@ballista/engine";
import { describe, expect, it } from "vitest";
import { SensitivityPanel } from "./sensitivity-panel.js";
import {
  SENSITIVITY_CHANNELS,
  computeSensitivityReadout,
  type SensitivityReadout,
} from "./sensitivity-panel-logic.js";

/** JSX array children come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring the other panel tests. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

type Node = { type?: string; props?: Record<string, unknown> };

/** Every node in the rendered tree carrying `data-testid`, keyed by it. */
function byTestId(vnode: Node): Map<string, Node> {
  const found = new Map<string, Node>();
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const candidate = node as Node;
    const id = candidate.props?.["data-testid"];
    if (typeof id === "string") found.set(id, candidate);
    for (const child of flatChildren(candidate.props?.["children"])) walk(child);
  };
  walk(vnode);
  return found;
}

function textOf(node: Node | undefined): string {
  return flatChildren(node?.props?.["children"]).join("");
}

const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;
const DRAG_FREE = PRESET_SCENARIOS[0]!;

describe("SensitivityPanel", () => {
  it("renders one row per channel and a number in each, for a scenario that has all three", () => {
    const readout = computeSensitivityReadout(SHOT_PUT);
    const nodes = byTestId(SensitivityPanel({ readout }));

    for (const channel of SENSITIVITY_CHANNELS) {
      expect(nodes.has(`sensitivity-row-${channel.id}`)).toBe(true);
      expect(textOf(nodes.get(`sensitivity-value-${channel.id}`))).toMatch(
        new RegExp(`^-?\\d.*${channel.unit.replace(/[()/]/g, "\\$&")}$`),
      );
    }
    expect(nodes.has("sensitivity-failure")).toBe(false);
  });

  it("shows the value the logic computed, not a re-derivation of it", () => {
    const readout = computeSensitivityReadout(SHOT_PUT);
    const row = readout.channels.find((c) => c.id === "speed")!;
    if (row.status !== "ok") throw new Error("expected a value for dR/dv0");

    const nodes = byTestId(SensitivityPanel({ readout }));
    expect(textOf(nodes.get("sensitivity-value-speed"))).toBe(
      `${row.value.toPrecision(3)} m/(m/s)`,
    );
  });

  it("blanks a channel that has no number and puts the reason in its title", () => {
    const readout = computeSensitivityReadout(DRAG_FREE);
    const nodes = byTestId(SensitivityPanel({ readout }));

    expect(textOf(nodes.get("sensitivity-value-cd"))).toBe("—");
    expect(nodes.get("sensitivity-value-cd")?.props?.["title"]).toMatch(/no quadratic-drag force/i);
    // The aim channels still render numbers: one blank row is not a blank panel.
    expect(textOf(nodes.get("sensitivity-value-theta"))).toMatch(/m\/rad$/);
  });

  it("renders every row blank, plus the reason, when the whole solve has none", () => {
    const readout = computeSensitivityReadout({
      ...SHOT_PUT,
      initialConditions: { x0: 0, y0: 2, vx0: 0, vy0: 0 },
    });
    const nodes = byTestId(SensitivityPanel({ readout }));

    expect(textOf(nodes.get("sensitivity-failure"))).toMatch(/zero/i);
    for (const channel of SENSITIVITY_CHANNELS) {
      expect(textOf(nodes.get(`sensitivity-value-${channel.id}`))).toBe("—");
    }
  });

  it("renders em dashes and no failure text before any readout exists", () => {
    const nodes = byTestId(SensitivityPanel({ readout: undefined }));
    expect(nodes.has("sensitivity-failure")).toBe(false);
    for (const channel of SENSITIVITY_CHANNELS) {
      expect(textOf(nodes.get(`sensitivity-value-${channel.id}`))).toBe("—");
    }
  });

  it("shows the stepper substitution note only when there is one", () => {
    const plain = byTestId(SensitivityPanel({ readout: computeSensitivityReadout(SHOT_PUT) }));
    expect(plain.has("sensitivity-stepper-note")).toBe(false);

    const substituted: SensitivityReadout = computeSensitivityReadout({
      ...SHOT_PUT,
      solver: { ...SHOT_PUT.solver, stepper: "explicit-euler" },
    });
    const nodes = byTestId(SensitivityPanel({ readout: substituted }));
    expect(textOf(nodes.get("sensitivity-stepper-note"))).toMatch(/explicit-euler/);
  });
});
