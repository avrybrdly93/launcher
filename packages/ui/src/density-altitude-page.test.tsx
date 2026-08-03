import { describe, expect, it } from "vitest";
import { computeDensityAltitudeComparison } from "@ballista/runtime";
import { DensityAltitudePage } from "./density-altitude-page.js";
import { formatDensity, formatRangeIncrease } from "./density-altitude-page-logic.js";
import { formatMeters } from "./terrain-editor-page-logic.js";

/** Depth-first search of a raw Preact vnode tree for the first node whose `data-testid` matches, mirroring `neglected-effects-page.test.tsx`'s helper. */
function findByTestId(
  node: unknown,
  testId: string,
): { props: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const candidate = node as { props?: Record<string, unknown> };
  if (candidate.props && candidate.props["data-testid"] === testId) {
    return candidate as { props: Record<string, unknown> };
  }
  const children = candidate.props?.children;
  if (children === undefined) return undefined;
  for (const child of ([] as unknown[]).concat(children).flat(Infinity)) {
    const found = findByTestId(child, testId);
    if (found) return found;
  }
  return undefined;
}

function textOf(node: { props: Record<string, unknown> }): string {
  return ([] as unknown[]).concat(node.props.children).flat(Infinity).join("");
}

describe("DensityAltitudePage (P4.29)", () => {
  const result = computeDensityAltitudeComparison();

  it("renders sea-level altitude/density/range consistent with the resolved comparison", () => {
    const vnode = DensityAltitudePage({ result });
    expect(textOf(findByTestId(vnode, "density-altitude-sea-level-altitude")!)).toBe(
      formatMeters(result.seaLevel.altitude),
    );
    expect(textOf(findByTestId(vnode, "density-altitude-sea-level-rho")!)).toBe(
      formatDensity(result.seaLevel.rhoAir),
    );
    expect(textOf(findByTestId(vnode, "density-altitude-sea-level-range")!)).toBe(
      formatMeters(result.seaLevel.range),
    );
  });

  it("renders 2000 m altitude/density/range consistent with the resolved comparison", () => {
    const vnode = DensityAltitudePage({ result });
    expect(textOf(findByTestId(vnode, "density-altitude-high-altitude-altitude")!)).toBe(
      formatMeters(result.highAltitude.altitude),
    );
    expect(textOf(findByTestId(vnode, "density-altitude-high-altitude-rho")!)).toBe(
      formatDensity(result.highAltitude.rhoAir),
    );
    expect(textOf(findByTestId(vnode, "density-altitude-high-altitude-range")!)).toBe(
      formatMeters(result.highAltitude.range),
    );
  });

  it("renders the range increase matching the comparison's own computed value", () => {
    const vnode = DensityAltitudePage({ result });
    const increaseNode = findByTestId(vnode, "density-altitude-increase")!;
    expect(textOf(increaseNode)).toContain(
      formatRangeIncrease(result.rangeIncrease, result.rangeIncreasePercent),
    );
  });

  it("summary mentions both altitudes and the muzzle speed/elevation used", () => {
    const vnode = DensityAltitudePage({ result });
    const summary = textOf(findByTestId(vnode, "density-altitude-summary")!);
    expect(summary).toContain("2000 m");
    expect(summary).toContain(String(result.muzzleSpeed));
  });
});
