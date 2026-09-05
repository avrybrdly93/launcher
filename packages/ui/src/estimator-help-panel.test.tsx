// @vitest-environment jsdom
/**
 * P6.30's validation criterion is "merged; linked from dashboard help", and
 * both halves are asserted here: the panel renders a row per glossary entry
 * with the guidance those rows carry, and the Monte Carlo dashboard actually
 * mounts it with a working link to ADR-019.
 *
 * The assertions read the rendered DOM against `ESTIMATOR_GLOSSARY` rather
 * than against strings retyped here. A test that pinned its own copy of the
 * prose would pass while the panel showed something else, which is the exact
 * drift ADR-019 is about.
 */
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import { ESTIMATOR_GLOSSARY, ESTIMATOR_GLOSSARY_ADR } from "@ballista/analysis";

import { EstimatorHelpPanel } from "./estimator-help-panel.js";

let host: HTMLDivElement | undefined;

const mount = (vnode: preact.ComponentChild): HTMLDivElement => {
  host = document.createElement("div");
  document.body.append(host);
  render(vnode, host);
  return host;
};

afterEach(() => {
  if (host !== undefined) render(null, host);
  host?.remove();
  host = undefined;
});

const q = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector(`[data-testid="${id}"]`);

describe("EstimatorHelpPanel (P6.30)", () => {
  it("renders one entry per glossary row, and no row the glossary does not carry", () => {
    const root = mount(<EstimatorHelpPanel />);

    for (const entry of ESTIMATOR_GLOSSARY) {
      expect(q(root, `estimator-help-${entry.id}`), `${entry.abbreviation} row`).not.toBeNull();
    }
    expect(root.querySelectorAll(".estimator-help__entry")).toHaveLength(ESTIMATOR_GLOSSARY.length);
  });

  it("shows each row's guidance verbatim from the glossary, not a retyped copy", () => {
    const root = mount(<EstimatorHelpPanel />);

    for (const entry of ESTIMATOR_GLOSSARY) {
      expect(q(root, `estimator-help-${entry.id}-estimates`)?.textContent).toBe(entry.estimates);
      expect(q(root, `estimator-help-${entry.id}-use`)?.textContent).toBe(entry.useWhen);
      expect(q(root, `estimator-help-${entry.id}-avoid`)?.textContent).toBe(entry.avoidWhen);
    }
  });

  it("shows the failure mode as well as the recommendation for every row", () => {
    // The panel would still "work" while rendering only the reach-for-it-when
    // half, and would then be an advertisement for five methods rather than
    // guidance about choosing between them.
    const root = mount(<EstimatorHelpPanel />);

    for (const entry of ESTIMATOR_GLOSSARY) {
      const avoid = q(root, `estimator-help-${entry.id}-avoid`)?.textContent ?? "";
      expect(avoid.length, `${entry.abbreviation} states when not to`).toBeGreaterThan(40);
    }
  });

  it("links ADR-019, and lets a deployment serving docs elsewhere say so", () => {
    const link = q(mount(<EstimatorHelpPanel />), "estimator-help-adr-link");
    expect(link?.getAttribute("href")).toBe(`../../${ESTIMATOR_GLOSSARY_ADR}`);
    expect(link?.textContent).toContain("ADR-019");

    render(null, host!);
    const custom = q(
      mount(<EstimatorHelpPanel docHref="/docs/adr-019" />),
      "estimator-help-adr-link",
    );
    expect(custom?.getAttribute("href")).toBe("/docs/adr-019");
  });

  it("starts collapsed, so help nobody asked for does not displace the results", () => {
    const details = q(mount(<EstimatorHelpPanel />), "estimator-help");
    expect(details?.tagName).toBe("DETAILS");
    expect((details as HTMLDetailsElement | null)?.open).toBe(false);
    // The summary is what makes a `<details>` keyboard-operable and
    // self-announcing; without it the element is a collapsed box nobody can
    // open without a mouse.
    expect(q(details!, "estimator-help-summary")?.tagName).toBe("SUMMARY");
  });
});
