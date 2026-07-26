/**
 * Pure markdown-with-LaTeX parser for the SolverKit derivation pages
 * (`packages/solverkit/src/*.derivation.md`, P2.51) into a small block/inline
 * AST {@link lazy-katex-pane.ts} can render (§6.3 "each exhibit pairs the
 * interactive view with a short derivation panel (rendered from the same
 * markdown/LaTeX sources as this document's Section 4 -- single-source
 * pedagogy)", P3.45). No DOM/KaTeX dependency here -- pure data shaping,
 * unit-tested directly against the real derivation files, mirroring
 * `lazy-plotly-pane.ts`'s figure builders.
 *
 * Deliberately not a general CommonMark implementation: it covers exactly
 * the subset these files actually use (headings, paragraphs, numbered/
 * bulleted lists whose items may wrap across lines, `**bold**`,
 * `` `inline code` ``, TypeDoc `{@link Symbol}` references, and `$...$`/
 * `$$...$$` TeX math) -- verified file-by-file in
 * `derivation-markdown.test.ts` rather than assumed. Every observed
 * `$$...$$` block in these files already occupies its own blank-line-
 * delimited block (opens and closes the block with no other text), so
 * display math is recognized at the block level rather than needing a
 * separate whole-source extraction pass; `$...$` inline math is recognized
 * within a paragraph/list-item's inline run instead.
 */

/** One inline run within a heading, paragraph, or list item. */
export type DerivationInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bold"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string }
  | { readonly kind: "math"; readonly tex: string };

/** One block-level element of a parsed derivation page, in source order. */
export type DerivationBlock =
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly inlines: readonly DerivationInline[];
    }
  | { readonly kind: "paragraph"; readonly inlines: readonly DerivationInline[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly DerivationInline[])[];
    }
  | { readonly kind: "display-math"; readonly tex: string };

const LIST_ITEM_PATTERN = /^(\d+\.|-)\s+/;

/** Splits `source` into blank-line-delimited blocks, each with its lines rejoined by `\n` and outer whitespace trimmed. */
function splitBlocks(source: string): string[] {
  return source
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Parses one heading/paragraph/list-item's inline text into a run of
 * {@link DerivationInline}s. Recognizes, left to right, whichever of
 * `$$...$$`-free `$...$` math, `{@link Symbol}`, `` `code` ``, or
 * `**bold**` starts earliest at each position; everything between
 * recognized spans is plain text. Patterns don't nest (none of these
 * files' actual content needs it).
 */
function parseInlines(text: string): DerivationInline[] {
  const inlines: DerivationInline[] = [];
  const pattern = /\$([^$\n]+?)\$|\{@link\s+([^}]+?)\}|`([^`]+?)`|\*\*([^*]+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      inlines.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    const [, mathTex, linkText, codeText, boldText] = match;
    if (mathTex !== undefined) {
      inlines.push({ kind: "math", tex: mathTex });
    } else if (linkText !== undefined) {
      inlines.push({ kind: "link", text: linkText });
    } else if (codeText !== undefined) {
      inlines.push({ kind: "code", text: codeText });
    } else if (boldText !== undefined) {
      inlines.push({ kind: "bold", text: boldText });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    inlines.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return inlines;
}

/** Joins a block's physical lines back into flowing prose (soft-wrapped source lines are not semantic line breaks in these files). */
function joinLines(lines: readonly string[]): string {
  return lines.map((line) => line.trim()).join(" ");
}

/** Splits a list block's lines into per-item line groups: a line matching {@link LIST_ITEM_PATTERN} starts a new item, every following non-matching line is that item's wrapped continuation. */
function splitListItems(lines: readonly string[]): string[][] {
  const items: string[][] = [];
  for (const line of lines) {
    if (LIST_ITEM_PATTERN.test(line)) {
      items.push([line.replace(LIST_ITEM_PATTERN, "")]);
    } else if (items.length > 0) {
      items.at(-1)!.push(line);
    }
  }
  return items;
}

function parseBlock(raw: string): DerivationBlock {
  if (raw.startsWith("$$") && raw.endsWith("$$")) {
    return { kind: "display-math", tex: raw.slice(2, -2).trim() };
  }

  const lines = raw.split("\n");
  const headingMatch = /^(#{1,6})\s+(.*)$/.exec(lines[0]!);
  if (headingMatch && lines.length === 1) {
    return {
      kind: "heading",
      level: headingMatch[1]!.length,
      inlines: parseInlines(headingMatch[2]!),
    };
  }

  if (LIST_ITEM_PATTERN.test(lines[0]!)) {
    const ordered = /^\d+\./.test(lines[0]!);
    const items = splitListItems(lines).map((itemLines) => parseInlines(joinLines(itemLines)));
    return { kind: "list", ordered, items };
  }

  return { kind: "paragraph", inlines: parseInlines(joinLines(lines)) };
}

/** Parses a derivation page's raw markdown source into its block sequence, in source order. */
export function parseDerivationMarkdown(source: string): DerivationBlock[] {
  return splitBlocks(source).map(parseBlock);
}
