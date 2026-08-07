// P4.40 validation: "all equations render; cross-links valid".
//
// Both halves of that criterion are documentary — a session could mark the task done and
// nothing would ever contradict it. These tests make them falsifiable instead:
//
//   * "all equations render" -> every `$`/`$$` delimiter in the generated pages is balanced,
//     every equation tag the blueprint's §3 defines survives into the pages, and no page
//     carries a LaTeX construct that a Markdown math renderer would silently drop.
//   * "cross-links valid" -> every relative link resolves to a file that exists, every
//     in-page anchor resolves to a heading, and every Implementation-table symbol is a real
//     named export of the file it points at.
//
// Plus the drift check the other two depend on: the pages must be byte-identical to a fresh
// regeneration, so editing a page by hand (or editing the blueprint without regenerating)
// fails here rather than leaving the docs quietly stale.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs", "physics");

const generator = (await import(
  join(REPO_ROOT, "scripts", "generate-physics-docs.mjs")
)) as typeof import("../../../scripts/generate-physics-docs.mjs");

const blueprintText = readFileSync(join(REPO_ROOT, "ballista-technical-blueprint.md"), "utf8");
const map = JSON.parse(readFileSync(join(DOCS_DIR, "implementation-map.json"), "utf8"));
const expectedPages: Record<string, string> = generator.buildPages(blueprintText, map);
const pageNames = Object.keys(expectedPages);

/** Markdown pages actually committed under docs/physics/. */
const onDisk = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));

/** Strip fenced code blocks and HTML comments before looking at math delimiters. */
function mathText(source: string): string {
  return source.replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "");
}

describe("physics docs are a faithful regeneration of blueprint §3", () => {
  it("generates a page for every §3 subsection, and nothing else", () => {
    const sections = generator.extractSection3(blueprintText);
    expect(sections.map((s) => s.number)).toEqual([
      "3.1",
      "3.2",
      "3.3",
      "3.4",
      "3.5",
      "3.6",
      "3.7",
      "3.8",
      "3.9",
    ]);
    // 9 subsections + the index.
    expect(pageNames).toHaveLength(10);
    expect(onDisk.slice().sort()).toEqual(pageNames.slice().sort());
  });

  it.each(pageNames)("%s is byte-identical to a fresh regeneration", (name) => {
    const actual = readFileSync(join(DOCS_DIR, name), "utf8");
    expect(actual).toBe(expectedPages[name]);
  });

  it("copies the blueprint prose through verbatim rather than paraphrasing it", () => {
    // If the generator ever starts rewriting the source, this catches it: the §3.2 body must
    // appear in the page exactly as the blueprint has it.
    const gravity = generator
      .extractSection3(blueprintText)
      .find((s: { number: string }) => s.number === "3.2")!;
    const page = readFileSync(join(DOCS_DIR, "gravity.md"), "utf8");
    expect(page).toContain(gravity.body);
  });
});

describe("all equations render", () => {
  it.each(pageNames)("%s has balanced math delimiters", (name) => {
    const text = mathText(expectedPages[name]);

    const displayCount = (text.match(/\$\$/g) ?? []).length;
    expect(displayCount % 2, `unbalanced $$ in ${name}`).toBe(0);

    // Remove display math, then inline `$...$` must also pair up.
    const inlineOnly = text.replace(/\$\$[\s\S]*?\$\$/g, "");
    const inlineCount = (inlineOnly.match(/\$/g) ?? []).length;
    expect(inlineCount % 2, `unbalanced $ in ${name}`).toBe(0);
  });

  it.each(pageNames)("%s has balanced LaTeX grouping inside each math block", (name) => {
    const text = mathText(expectedPages[name]);
    const blocks = [
      ...(text.match(/\$\$[\s\S]*?\$\$/g) ?? []),
      ...(text.replace(/\$\$[\s\S]*?\$\$/g, "").match(/\$[^$\n]+\$/g) ?? []),
    ];
    for (const block of blocks) {
      // \{ and \} are literal braces, not grouping — drop the escapes first.
      const stripped = block.replace(/\\[{}]/g, "");
      const opens = (stripped.match(/\{/g) ?? []).length;
      const closes = (stripped.match(/\}/g) ?? []).length;
      expect(opens, `unbalanced braces in ${name}: ${block.slice(0, 60)}`).toBe(closes);

      const lefts = (stripped.match(/\\left/g) ?? []).length;
      const rights = (stripped.match(/\\right/g) ?? []).length;
      expect(lefts, `unmatched \\left/\\right in ${name}: ${block.slice(0, 60)}`).toBe(rights);

      const begins = (stripped.match(/\\begin\{/g) ?? []).length;
      const ends = (stripped.match(/\\end\{/g) ?? []).length;
      expect(begins, `unmatched \\begin/\\end in ${name}: ${block.slice(0, 60)}`).toBe(ends);
    }
  });

  it("carries every numbered equation from §3 into the pages", () => {
    const section3 = generator
      .extractSection3(blueprintText)
      .map((s: { body: string }) => s.body)
      .join("\n");
    const tags = [...section3.matchAll(/\\tag\{(3\.\d+)\}/g)].map((m) => m[1]);

    // §3 is the platform's physics reference; if it ever stops numbering equations, this
    // whole check would pass vacuously.
    expect(tags.length).toBeGreaterThanOrEqual(19);

    const allPages = pageNames.map((n) => expectedPages[n]).join("\n");
    for (const tag of tags) {
      expect(allPages, `equation (${tag}) missing from generated pages`).toContain(`\\tag{${tag}}`);
    }
  });

  it("leaves no unrendered placeholder or generator artifact on a page", () => {
    for (const name of pageNames) {
      const text = mathText(expectedPages[name]);
      expect(text, `${name} contains a TODO`).not.toMatch(/\bTODO\b|\bFIXME\b/);
      // What a broken generator actually emits — a missing map entry or a bad interpolation.
      // (A `{{…}}` check would be wrong here: `}}` occurs constantly in legitimate LaTeX,
      // e.g. `\lVert\mathbf{v}_{\text{rel}}\rVert`.)
      expect(text, `${name} interpolated undefined`).not.toMatch(/\bundefined\b/);
      expect(text, `${name} interpolated an object`).not.toContain("[object Object]");
      expect(text, `${name} has an empty table cell`).not.toMatch(/\|\s*\|\s*\|/);
    }
  });
});

describe("cross-links valid", () => {
  /** [text, target] for every inline Markdown link on a page. */
  function links(source: string): Array<[string, string]> {
    return [...source.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => [m[1], m[2]]);
  }

  function headingAnchors(source: string): Set<string> {
    return new Set(
      [...source.matchAll(/^#{1,6} (.+?)\s*$/gm)].map((m) =>
        m[1]
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-"),
      ),
    );
  }

  it("every page is reachable from the index", () => {
    const index = expectedPages["README.md"];
    for (const name of pageNames) {
      if (name === "README.md") continue;
      expect(index, `${name} is not linked from the index`).toContain(`(./${name})`);
    }
  });

  it.each(pageNames)("%s: every relative link resolves", (name) => {
    for (const [, target] of links(expectedPages[name])) {
      if (/^https?:/.test(target)) continue;

      const [pathPart, anchor] = target.split("#");
      if (pathPart === "") {
        // Pure in-page anchor.
        expect(
          headingAnchors(expectedPages[name]),
          `${name}: in-page anchor #${anchor} has no matching heading`,
        ).toContain(anchor);
        continue;
      }

      const resolved = resolve(DOCS_DIR, pathPart);
      expect(existsSync(resolved), `${name}: link target ${target} does not exist`).toBe(true);

      if (anchor && resolved.endsWith(".md")) {
        const targetText = readFileSync(resolved, "utf8");
        expect(
          headingAnchors(targetText),
          `${name}: anchor #${anchor} not found in ${pathPart}`,
        ).toContain(anchor);
      }
    }
  });

  it("every implementation-map entry points at a real named export", () => {
    const sections = map.sections as Record<
      string,
      Array<{ symbol: string; file: string; note: string }>
    >;
    const entries = Object.values(sections).flat();
    expect(entries.length).toBeGreaterThan(40);

    for (const { symbol, file } of entries) {
      const abs = join(REPO_ROOT, file);
      expect(existsSync(abs), `implementation-map: ${file} does not exist`).toBe(true);

      const source = readFileSync(abs, "utf8");
      const exported = new RegExp(
        `^export\\s+(?:default\\s+)?(?:async\\s+)?` +
          `(?:abstract\\s+)?(?:class|function|const|let|var|interface|type|enum)\\s+` +
          `${symbol}\\b`,
        "m",
      );
      expect(
        exported.test(source),
        `implementation-map: ${symbol} is not exported from ${file}`,
      ).toBe(true);
    }
  });

  it("every §3 subsection has at least one implementation link", () => {
    const sections = generator.extractSection3(blueprintText);
    for (const s of sections) {
      const entries = (map.sections as Record<string, unknown[]>)[s.number];
      expect(entries, `§${s.number} has no implementation-map entry`).toBeDefined();
      expect(entries!.length, `§${s.number} has an empty implementation-map entry`).toBeGreaterThan(
        0,
      );
    }
  });

  it("implementation-map notes are real, distinct prose", () => {
    // Deliberately not a minimum length: some notes legitimately are "Eq. (3.10)." and
    // padding them to clear a character count would be busywork, not rigor. What actually
    // signals a stub is an empty note or the same note copy-pasted across entries.
    const entries = Object.values(
      map.sections as Record<string, Array<{ symbol: string; note: string }>>,
    ).flat();

    const seen = new Map<string, string>();
    for (const { symbol, note } of entries) {
      const trimmed = note.trim();
      expect(trimmed, `${symbol} has an empty note`).not.toBe("");
      expect(trimmed, `${symbol}'s note is not a sentence`).toMatch(/[.!?)]$/);
      const prior = seen.get(trimmed);
      expect(prior, `${symbol} reuses ${prior}'s note verbatim`).toBeUndefined();
      seen.set(trimmed, symbol);
    }
  });

  it("no symbol is mapped twice within one section", () => {
    for (const [number, entries] of Object.entries(
      map.sections as Record<string, Array<{ symbol: string; file: string }>>,
    )) {
      const keys = entries.map((e) => `${e.file}#${e.symbol}`);
      expect(new Set(keys).size, `§${number} lists a duplicate symbol`).toBe(keys.length);
    }
  });
});
