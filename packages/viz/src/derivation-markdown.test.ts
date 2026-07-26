import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDerivationMarkdown, type DerivationBlock } from "./derivation-markdown.js";

const SOLVERKIT_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../solverkit/src");

function loadDerivation(name: string): string {
  return readFileSync(join(SOLVERKIT_SRC, `${name}.derivation.md`), "utf8");
}

type Heading = Extract<DerivationBlock, { kind: "heading" }>;
type ListBlock = Extract<DerivationBlock, { kind: "list" }>;

function flattenText(
  inlines: readonly { readonly text?: string; readonly tex?: string }[],
): string {
  return inlines.map((inline) => inline.text ?? inline.tex ?? "").join("");
}

describe("parseDerivationMarkdown (P3.45)", () => {
  it("parses explicit-euler-stepper's title, sections, display math, and both list styles", () => {
    const blocks = parseDerivationMarkdown(loadDerivation("explicit-euler-stepper"));

    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(flattenText((blocks[0] as Heading).inlines)).toContain("Explicit (Forward) Euler");

    const headings = blocks.filter((b): b is Heading => b.kind === "heading" && b.level === 2);
    expect(headings.map((h) => flattenText(h.inlines))).toEqual([
      "Scheme",
      "Derivation",
      "Pitfalls (each demonstrable in-platform)",
      "Kahan-compensated variant",
      "See also",
    ]);

    const displayMath = blocks.filter(
      (b): b is Extract<DerivationBlock, { kind: "display-math" }> => b.kind === "display-math",
    );
    expect(displayMath.length).toBeGreaterThanOrEqual(1);
    expect(displayMath[0]!.tex).toContain("\\mathbf y_{k+1}");
    expect(displayMath[0]!.tex).toContain("\\tag{4.2}");
    // No stray "$$" survives into the extracted tex.
    for (const block of displayMath) expect(block.tex).not.toContain("$$");

    const orderedList = blocks.find((b): b is ListBlock => b.kind === "list" && b.ordered)!;
    expect(orderedList.items).toHaveLength(3);
    // Each numbered pitfall opens with a **bold** lead-in, parsed as its own inline.
    expect(orderedList.items[0]![0]).toMatchObject({ kind: "bold" });
    // Wrapped continuation lines join into the same item, not a new one.
    expect(flattenText(orderedList.items[0]!)).toContain("Dahlquist test equation");

    const bulletList = blocks.find((b): b is ListBlock => b.kind === "list" && !b.ordered)!;
    expect(bulletList.items).toHaveLength(2);
    expect(bulletList.items[0]![0]).toMatchObject({
      kind: "link",
      text: "SemiImplicitEulerStepper",
    });
  });

  it("parses classical-rk4-stepper's multi-line Butcher-tableau display-math block as one block, tag included", () => {
    const blocks = parseDerivationMarkdown(loadDerivation("classical-rk4-stepper"));
    const tableau = blocks.find(
      (b): b is DerivationBlock & { kind: "display-math" } =>
        b.kind === "display-math" && b.tex.includes("begin{array}"),
    )!;
    expect(tableau).toBeDefined();
    expect(tableau.tex).toContain("\\begin{aligned}");
    expect(tableau.tex).toContain("\\tag{4.6}");
  });

  it("recognizes inline math within prose alongside plain text, distinct from display math", () => {
    const blocks = parseDerivationMarkdown(loadDerivation("backward-euler-stepper"));
    const stabilityParagraph = blocks.find(
      (b): b is DerivationBlock & { kind: "paragraph" } =>
        b.kind === "paragraph" && flattenText(b.inlines).includes("A-stable"),
    )!;
    const mathInlines = stabilityParagraph.inlines.filter((i) => i.kind === "math");
    expect(mathInlines.length).toBeGreaterThan(0);
    expect(mathInlines.some((i) => (i as { tex: string }).tex.includes("\\operatorname{Re}"))).toBe(
      true,
    );
  });

  it("parses every shipped *.derivation.md file without throwing, producing at least a title heading and one display-math block", () => {
    const files = readdirSync(SOLVERKIT_SRC).filter((f) => f.endsWith(".derivation.md"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(SOLVERKIT_SRC, file), "utf8");
      const blocks = parseDerivationMarkdown(source);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
      expect(blocks.some((b) => b.kind === "display-math")).toBe(true);
    }
  });
});
