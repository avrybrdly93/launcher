import { describe, expect, it, vi } from "vitest";
import { PRESET_SCENARIOS } from "@ballista/engine";
import { ALL_REGIME_TAGS } from "./preset-browser-logic.js";
import { PresetBrowser } from "./preset-browser.js";

/** JSX array children (`{items.map(...)}`) come back as nested arrays in the raw vnode tree -- flatten before inspecting, mirroring `projectile-panel.test.tsx`'s helper. */
function flatChildren(children: unknown): unknown[] {
  return ([] as unknown[]).concat(children).flat(Infinity);
}

type ButtonVNode = { type: string; props: { "aria-pressed"?: boolean; onClick: () => void } };
type ListVNode = { type: string; props: { children: unknown } };

function render(selectedTag: string | null, onSelectTag = vi.fn(), onSelectPreset = vi.fn()) {
  const vnode = PresetBrowser({ selectedTag: selectedTag as never, onSelectTag, onSelectPreset });
  const [tagsDiv, list] = flatChildren(vnode.props.children) as [ListVNode, ListVNode];
  const tagButtons = flatChildren(tagsDiv.props.children) as ButtonVNode[];
  const entries = flatChildren(list.props.children) as { props: { children: unknown } }[];
  return { vnode, tagButtons, entries, onSelectTag, onSelectPreset };
}

describe("PresetBrowser: tag filter chips", () => {
  it("renders an 'All' chip plus one chip per ALL_REGIME_TAGS", () => {
    const { tagButtons } = render(null);
    expect(tagButtons).toHaveLength(ALL_REGIME_TAGS.length + 1);
  });

  it("marks the 'All' chip pressed when selectedTag is null, and no tag chip pressed", () => {
    const { tagButtons } = render(null);
    const [all, ...tags] = tagButtons;
    expect(all!.props["aria-pressed"]).toBe(true);
    for (const tag of tags) expect(tag.props["aria-pressed"]).toBe(false);
  });

  it("marks exactly the selected tag's chip pressed", () => {
    const { tagButtons } = render("magnus");
    const [all, ...tags] = tagButtons;
    expect(all!.props["aria-pressed"]).toBe(false);
    const pressedCount = tags.filter((t) => t.props["aria-pressed"] === true).length;
    expect(pressedCount).toBe(1);
  });

  it("clicking the 'All' chip calls onSelectTag(null)", () => {
    const { tagButtons, onSelectTag } = render("stiff");
    tagButtons[0]!.props.onClick();
    expect(onSelectTag).toHaveBeenCalledWith(null);
  });

  it("clicking a tag chip calls onSelectTag with that tag", () => {
    const { tagButtons, onSelectTag } = render(null);
    // index 1 is the first real tag chip (index 0 is "All")
    tagButtons[1]!.props.onClick();
    expect(onSelectTag).toHaveBeenCalledWith(ALL_REGIME_TAGS[0]);
  });
});

describe("PresetBrowser: preset list (P3.33 validation criterion: filtering by tag works)", () => {
  it("with no tag selected, lists every preset in the library", () => {
    const { entries } = render(null);
    expect(entries).toHaveLength(PRESET_SCENARIOS.length);
  });

  it("filtering by 'magnus' shows only the golf-drive preset", () => {
    const { entries } = render("magnus");
    expect(entries).toHaveLength(1);
  });

  it("filtering by 'stiff' shows only the dust-grain preset", () => {
    const { entries } = render("stiff");
    expect(entries).toHaveLength(1);
  });

  it("selecting a listed preset commits its full ScenarioSpec", () => {
    const { entries, onSelectPreset } = render("magnus");
    const [selectButton] = flatChildren(entries[0]!.props.children) as {
      props: { onClick: () => void };
    }[];
    selectButton!.props.onClick();

    const golfDrive = PRESET_SCENARIOS.find((s) => s.projectile.id === "golf-ball")!;
    expect(onSelectPreset).toHaveBeenCalledWith(golfDrive);
  });
});
