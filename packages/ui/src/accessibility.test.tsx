// @vitest-environment jsdom
/**
 * Keyboard operability / ARIA audit (P3.34). Mounts every interactive panel
 * component into a real jsdom document (via preact's `render`, not the
 * vnode-inspection style the rest of this package's tests use -- axe-core
 * needs an actual DOM to walk) and runs an axe-core audit against it.
 *
 * Only `impact: "critical"` violations fail the test (this task's literal
 * validation criterion, "axe-core audit: no critical violations"); any
 * lower-impact finding is still surfaced via the failure message so it's
 * visible without silently gating the build on it.
 */

import axe from "axe-core";
import { render, type ComponentChildren } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESET_SCENARIOS,
  PROJECTILE_ASSETS,
  type EnvironmentSpec,
  type ProjectileSpec,
  type SolverConfigSpec,
} from "@ballista/engine";
import { AdvisorHintPanel } from "./advisor-hint-panel.js";
import { CompareLegend } from "./compare-legend.js";
import { EnvironmentPanel } from "./environment-panel.js";
import { ForcesPanel } from "./forces-panel.js";
import type { LaunchSpec } from "./launch-schema.js";
import { LaunchPanel } from "./launch-panel.js";
import { ModelPicker } from "./model-picker.js";
import { PresetBrowser } from "./preset-browser.js";
import { ProjectilePanel } from "./projectile-panel.js";
import { CUSTOM_PROJECTILE_ID } from "./projectile-panel-logic.js";
import { SolverPanel } from "./solver-panel.js";

const LAUNCH_SPEC: LaunchSpec = { v0: 30, theta: 45, y0: 0, omega: 0 };

const GOLF_BALL = PROJECTILE_ASSETS.find((p) => p.id === "golf-ball")!;
const CUSTOM_PROJECTILE: ProjectileSpec = {
  ...GOLF_BALL,
  id: CUSTOM_PROJECTILE_ID,
  dragModel: { kind: "constant", cd: 0.47 },
};

const ENVIRONMENT: EnvironmentSpec = {
  atmosphere: { kind: "constant" },
  gravity: { g0: 9.80665, altitudeDependent: false },
  wind: { kind: "zero" },
};

const FIXED_SOLVER: SolverConfigSpec = { stepper: "classical-rk4", h: 0.01, maxSteps: 1000 };
const ADAPTIVE_SOLVER: SolverConfigSpec = {
  stepper: "dopri5",
  rtol: 1e-6,
  atol: 1e-6,
  controller: "I",
  maxSteps: 1000,
};

const GOLF_DRIVE = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("magnus"))!;

const COMPARE_ENTRIES = [
  { id: "pin-0", label: "Explicit Euler", color: "#2a78d6" },
  { id: "pin-1", label: "Classical RK4", color: "#eb6834" },
];

let container: HTMLDivElement | undefined;

function mount(children: ComponentChildren): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  render(children, container);
  return container;
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
});

/**
 * Rules that require actual layout/paint (color-contrast, target-size, ...)
 * are meaningless against jsdom's unstyled DOM -- this package has no
 * stylesheet loaded in tests, so every element reports the browser's zero
 * default styling and those rules would fail (or trivially pass) for
 * reasons unrelated to markup correctness. Disabled here; a real visual
 * contrast/hit-target audit belongs to P3.46's Playwright suite once the
 * app is actually wired up and stylesheets are loaded.
 */
const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    "color-contrast": { enabled: false },
    "target-size": { enabled: false },
  },
};

async function auditNoCriticalViolations(children: ComponentChildren): Promise<void> {
  const el = mount(children);
  const results = await axe.run(el, AXE_OPTIONS);
  const critical = results.violations.filter((v) => v.impact === "critical");

  if (critical.length > 0) {
    const detail = critical
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s): ${v.nodes[0]?.target.join(" ")})`)
      .join("\n");
    expect.fail(`critical axe violations:\n${detail}`);
  }
}

describe("Accessibility audit (P3.34 validation criterion: axe-core, no critical violations)", () => {
  it("LaunchPanel", async () => {
    await auditNoCriticalViolations(<LaunchPanel value={LAUNCH_SPEC} onChange={vi.fn()} />);
  });

  it("ProjectilePanel: preset selected", async () => {
    await auditNoCriticalViolations(<ProjectilePanel projectile={GOLF_BALL} onChange={vi.fn()} />);
  });

  it("ProjectilePanel: custom projectile (drag-coefficient controls shown)", async () => {
    await auditNoCriticalViolations(
      <ProjectilePanel projectile={CUSTOM_PROJECTILE} onChange={vi.fn()} />,
    );
  });

  it("EnvironmentPanel", async () => {
    await auditNoCriticalViolations(
      <EnvironmentPanel environment={ENVIRONMENT} onChange={vi.fn()} />,
    );
  });

  it("ForcesPanel", async () => {
    await auditNoCriticalViolations(
      <ForcesPanel forceIds={GOLF_DRIVE.model.forceIds} glyphSet={undefined} onChange={vi.fn()} />,
    );
  });

  it("SolverPanel: fixed-step", async () => {
    await auditNoCriticalViolations(<SolverPanel solver={FIXED_SOLVER} onChange={vi.fn()} />);
  });

  it("SolverPanel: adaptive (controller select shown)", async () => {
    await auditNoCriticalViolations(<SolverPanel solver={ADAPTIVE_SOLVER} onChange={vi.fn()} />);
  });

  it("PresetBrowser", async () => {
    await auditNoCriticalViolations(
      <PresetBrowser selectedTag={null} onSelectTag={vi.fn()} onSelectPreset={vi.fn()} />,
    );
  });

  it("ModelPicker", async () => {
    await auditNoCriticalViolations(<ModelPicker scenario={GOLF_DRIVE} onChange={vi.fn()} />);
  });

  it("CompareLegend", async () => {
    await auditNoCriticalViolations(<CompareLegend entries={COMPARE_ENTRIES} onUnpin={vi.fn()} />);
  });

  it("AdvisorHintPanel", async () => {
    await auditNoCriticalViolations(<AdvisorHintPanel scenario={GOLF_DRIVE} />);
  });

  it("all panels mounted together (a composite control dock)", async () => {
    await auditNoCriticalViolations(
      <div>
        <LaunchPanel value={LAUNCH_SPEC} onChange={vi.fn()} />
        <ProjectilePanel projectile={GOLF_BALL} onChange={vi.fn()} />
        <EnvironmentPanel environment={ENVIRONMENT} onChange={vi.fn()} />
        <ForcesPanel forceIds={GOLF_DRIVE.model.forceIds} glyphSet={undefined} onChange={vi.fn()} />
        <SolverPanel solver={ADAPTIVE_SOLVER} onChange={vi.fn()} />
        <ModelPicker scenario={GOLF_DRIVE} onChange={vi.fn()} />
        <PresetBrowser selectedTag={null} onSelectTag={vi.fn()} onSelectPreset={vi.fn()} />
        <CompareLegend entries={COMPARE_ENTRIES} onUnpin={vi.fn()} />
        <AdvisorHintPanel scenario={GOLF_DRIVE} />
      </div>,
    );
  });
});

describe("Keyboard operability: every interactive control is natively tabbable", () => {
  it("no interactive element is pulled out of tab order (no tabindex=-1) or an inert div masquerading as a control", async () => {
    const el = mount(
      <div>
        <LaunchPanel value={LAUNCH_SPEC} onChange={vi.fn()} />
        <ProjectilePanel projectile={CUSTOM_PROJECTILE} onChange={vi.fn()} />
        <EnvironmentPanel environment={ENVIRONMENT} onChange={vi.fn()} />
        <ForcesPanel forceIds={GOLF_DRIVE.model.forceIds} glyphSet={undefined} onChange={vi.fn()} />
        <SolverPanel solver={ADAPTIVE_SOLVER} onChange={vi.fn()} />
        <ModelPicker scenario={GOLF_DRIVE} onChange={vi.fn()} />
        <PresetBrowser selectedTag={null} onSelectTag={vi.fn()} onSelectPreset={vi.fn()} />
        <CompareLegend entries={COMPARE_ENTRIES} onUnpin={vi.fn()} />
      </div>,
    );

    const interactive = el.querySelectorAll("input, select, button, a[href]");
    expect(interactive.length).toBeGreaterThan(0);

    for (const node of interactive) {
      expect(node.getAttribute("tabindex")).not.toBe("-1");
      expect((node as HTMLElement).hidden).toBe(false);
    }
  });
});
