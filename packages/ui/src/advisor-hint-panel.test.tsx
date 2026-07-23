import { describe, expect, it } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { AdvisorHintPanel } from "./advisor-hint-panel.js";

const DUST_GRAIN = PRESET_SCENARIOS.find((s) => s.model.forceIds.includes("drag-linear"))!;
const DRAG_FREE = PRESET_SCENARIOS.find((s) => s.model.forceIds.length === 1)!;
const SHOT_PUT = PRESET_SCENARIOS.find((s) => s.projectile.id === "shot-put")!;

type Rendered = { type: string; props: Record<string, unknown> };

function renderedChildren(vnode: { props: { children: unknown; "data-regime"?: string } }): {
  regime: string | undefined;
  children: Rendered[];
} {
  const children = ([] as unknown[])
    .concat(vnode.props.children)
    .flat(Infinity)
    .filter((c): c is Rendered => typeof c === "object" && c !== null && "type" in c);
  return { regime: vnode.props["data-regime"], children };
}

describe("AdvisorHintPanel: dust-grain shows stiff hint (P3.24 validation criterion)", () => {
  it("the dust-grain preset renders the stiff regime with a rationale, a warning, and a backward-Euler doc link", () => {
    const vnode = AdvisorHintPanel({ scenario: DUST_GRAIN });
    const { regime, children } = renderedChildren(vnode);

    expect(regime).toBe("stiff");
    expect(children.map((c) => c.type)).toEqual(["p", "p", "a"]);

    const [rationaleP, warningP, docLink] = children;
    expect(rationaleP!.props.children).toMatch(/stiff|crawl/i);
    expect(warningP!.props.children).toMatch(/backward euler/i);
    expect(docLink!.props.href).toBe("./backward-euler-stepper.derivation.md");
  });
});

describe("AdvisorHintPanel: other regimes", () => {
  it("a gravity-only scenario renders conservation-focus with no warning and a Verlet doc link", () => {
    const vnode = AdvisorHintPanel({ scenario: DRAG_FREE });
    const { regime, children } = renderedChildren(vnode);

    expect(regime).toBe("conservation-focus");
    expect(children.map((c) => c.type)).toEqual(["p", "a"]);
    expect(children[1]!.props.href).toBe("./verlet-stepper.derivation.md");
  });

  it("a general drag scenario renders default-adaptive with no warning and a DOPRI5 doc link", () => {
    const vnode = AdvisorHintPanel({ scenario: SHOT_PUT });
    const { regime, children } = renderedChildren(vnode);

    expect(regime).toBe("default-adaptive");
    expect(children.map((c) => c.type)).toEqual(["p", "a"]);
    expect(children[1]!.props.href).toBe("./dormand-prince-54.derivation.md");
  });
});
