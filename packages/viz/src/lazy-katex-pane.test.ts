import { describe, expect, it } from "vitest";
import type { DerivationBlock } from "./derivation-markdown.js";
import { renderDerivationBlocksToHtml, type KatexModule } from "./lazy-katex-pane.js";

/** A stub `KatexModule` that renders math as an inspectable marker rather than real KaTeX HTML, so this stays unit-testable without loading the (lazy-only) real module. */
const STUB_KATEX: KatexModule = {
  renderToString: (tex, options) =>
    `<span data-display="${Boolean(options?.["displayMode"])}">${tex}</span>`,
};

describe("renderDerivationBlocksToHtml (P3.45)", () => {
  it("renders each block kind to its expected tag, delegating every math span to katex.renderToString", () => {
    const blocks: DerivationBlock[] = [
      { kind: "heading", level: 1, inlines: [{ kind: "text", text: "Title" }] },
      { kind: "heading", level: 2, inlines: [{ kind: "text", text: "Section" }] },
      {
        kind: "paragraph",
        inlines: [
          { kind: "text", text: "See " },
          { kind: "link", text: "Foo" },
          { kind: "text", text: ", speed " },
          { kind: "math", tex: "v_0" },
          { kind: "text", text: " and " },
          { kind: "bold", text: "note" },
          { kind: "text", text: " " },
          { kind: "code", text: "h" },
          { kind: "text", text: "." },
        ],
      },
      {
        kind: "list",
        ordered: true,
        items: [[{ kind: "text", text: "first" }], [{ kind: "text", text: "second" }]],
      },
      { kind: "display-math", tex: "E = mc^2" },
    ];

    const html = renderDerivationBlocksToHtml(blocks, STUB_KATEX);

    expect(html).toContain("<h3>Title</h3>");
    expect(html).toContain("<h4>Section</h4>");
    expect(html).toContain('<code class="derivation-panel-link">Foo</code>');
    expect(html).toContain('<span data-display="false">v_0</span>');
    expect(html).toContain("<strong>note</strong>");
    expect(html).toContain("<code>h</code>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain('<span data-display="true">E = mc^2</span>');
  });

  it("caps heading level at h6 rather than emitting an invalid tag", () => {
    const html = renderDerivationBlocksToHtml(
      [{ kind: "heading", level: 6, inlines: [{ kind: "text", text: "Deep" }] }],
      STUB_KATEX,
    );
    expect(html).toBe("<h6>Deep</h6>");
  });

  it("escapes HTML-significant characters in text/bold/code/link runs, never in math (which katex.renderToString itself owns)", () => {
    const html = renderDerivationBlocksToHtml(
      [
        {
          kind: "paragraph",
          inlines: [
            { kind: "text", text: "a < b & c > d" },
            { kind: "code", text: "<script>" },
          ],
        },
      ],
      STUB_KATEX,
    );
    expect(html).toContain("a &lt; b &amp; c &gt; d");
    expect(html).toContain("<code>&lt;script&gt;</code>");
  });

  it("renders an empty block list to an empty string", () => {
    expect(renderDerivationBlocksToHtml([], STUB_KATEX)).toBe("");
  });
});
