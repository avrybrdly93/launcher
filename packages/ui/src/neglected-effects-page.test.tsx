import { describe, expect, it } from "vitest";
import { computeNeglectedEffects } from "@ballista/runtime";
import { NeglectedEffectsPage } from "./neglected-effects-page.js";
import { formatRatioAsPercent } from "./neglected-effects-page-logic.js";

/** Depth-first search of a raw Preact vnode tree for the first node whose `data-testid` matches, mirroring `energy-drift-page.test.tsx`'s helper. */
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

describe("NeglectedEffectsPage (P4.20)", () => {
  const result = computeNeglectedEffects();

  it("renders the buoyancy-to-weight ratio matching the preset's own computed value", () => {
    const vnode = NeglectedEffectsPage({ result });
    const ratioNode = findByTestId(vnode, "neglected-effects-ratio")!;
    expect(textOf(ratioNode)).toBe(formatRatioAsPercent(result.buoyancyToWeightRatio));
  });

  it("renders mass/radius/volume/rho consistent with the resolved preset", () => {
    const vnode = NeglectedEffectsPage({ result });
    expect(textOf(findByTestId(vnode, "neglected-effects-mass")!)).toContain(
      result.mass.toPrecision(3),
    );
    expect(textOf(findByTestId(vnode, "neglected-effects-radius")!)).toContain(
      result.radius.toPrecision(3),
    );
    expect(textOf(findByTestId(vnode, "neglected-effects-volume")!)).toContain(
      result.volume.toPrecision(3),
    );
    expect(textOf(findByTestId(vnode, "neglected-effects-rho")!)).toContain(
      result.rhoAir.toPrecision(4),
    );
  });

  it("documents added mass as deliberately neglected, distinct from buoyancy's toggle", () => {
    const vnode = NeglectedEffectsPage({ result });
    const summary = textOf(findByTestId(vnode, "neglected-effects-summary")!);
    expect(summary.toLowerCase()).toContain("added mass");
  });
});
