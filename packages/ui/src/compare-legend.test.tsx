import { describe, expect, it } from "vitest";
import { CompareLegend } from "./compare-legend.js";

type Rendered = { type: string; props: Record<string, unknown> };

function flattenChildren(children: unknown): Rendered[] {
  return ([] as unknown[])
    .concat(children)
    .flat(Infinity)
    .filter((c): c is Rendered => typeof c === "object" && c !== null && "type" in c);
}

const ENTRIES = [
  { id: "pin-0", label: "Explicit Euler", color: "#2a78d6" },
  { id: "pin-1", label: "Classical RK4", color: "#eb6834" },
];

describe("CompareLegend", () => {
  it("renders nothing for an empty entry list", () => {
    expect(CompareLegend({ entries: [] })).toBeNull();
  });

  it("renders one row per entry with its swatch color and label, in order", () => {
    const vnode = CompareLegend({ entries: ENTRIES })!;
    const rows = flattenChildren(vnode.props.children);
    expect(rows).toHaveLength(2);

    rows.forEach((row, i) => {
      const entry = ENTRIES[i]!;
      expect(row.props["data-testid"]).toBe(`compare-legend-row-${entry.id}`);
      const [swatch, label] = flattenChildren(row.props.children);
      expect((swatch!.props.style as { backgroundColor: string }).backgroundColor).toBe(
        entry.color,
      );
      expect(label!.props.children).toBe(entry.label);
    });
  });

  it("omits the unpin button when onUnpin is not given", () => {
    const vnode = CompareLegend({ entries: ENTRIES })!;
    const [row] = flattenChildren(vnode.props.children);
    const cells = flattenChildren(row!.props.children);
    expect(cells.map((c) => c.type)).toEqual(["span", "span"]);
  });

  it("renders an unpin button per row wired to onUnpin(id) when given", () => {
    const unpinned: string[] = [];
    const vnode = CompareLegend({ entries: ENTRIES, onUnpin: (id) => unpinned.push(id) })!;
    const rows = flattenChildren(vnode.props.children);

    const [, , button] = flattenChildren(rows[0]!.props.children);
    expect(button!.type).toBe("button");
    (button!.props.onClick as () => void)();
    expect(unpinned).toEqual(["pin-0"]);
  });
});
