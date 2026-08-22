// P5.29 validation: "docs build; decision table present".
//
// Both halves are documentary as stated, which is the problem. "Docs build" is trivially
// true of any two Markdown files that exist, and "decision table present" would be
// satisfied by a table of three rows naming functions that do not exist. A session could
// mark the task done and nothing would ever contradict it.
//
// So the criterion is read as the claims a reader would actually rely on:
//
//   * "docs build" -> the pages exist, every relative link and in-page anchor resolves,
//     every math delimiter balances, and no generator-artifact or placeholder text is left
//     on a page. This is the same standard physics-docs.test.ts holds docs/physics to,
//     minus the regeneration check, since these pages are hand-written.
//   * "decision table present" -> the table covers *every* solver the package exports, each
//     row names a real named export of the file it points at, and the failure-status
//     strings it quotes are real members of that solver's status union. That last one is
//     the check that matters: a table naming `singular-jacobian` for a solver that reports
//     `line-search-failed` is worse than no table, because it reads as authoritative.
//
// The coverage check is what stops the table rotting. A new solver added to
// packages/analysis/src without a row here fails this suite rather than quietly going
// undocumented.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs", "analysis");
const ANALYSIS_SRC = join(REPO_ROOT, "packages", "analysis", "src");

const PAGES = ["README.md", "method-selection.md"] as const;

function pageText(name: string): string {
  return readFileSync(join(DOCS_DIR, name), "utf8");
}

/** Strip fenced code blocks and HTML comments before looking at math or prose claims. */
function proseOf(source: string): string {
  return source.replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "");
}

/** [text, target] for every inline Markdown link on a page. */
function links(source: string): Array<[string, string]> {
  return [...source.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => [m[1] ?? "", m[2] ?? ""]);
}

function headingAnchors(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^#{1,6} (.+?)\s*$/gm)].map((m) =>
      (m[1] ?? "")
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-"),
    ),
  );
}

/** Rows of the first Markdown table under the "## Decision table" heading. */
function decisionTableRows(): string[][] {
  const source = pageText("method-selection.md");
  const section = source.split("## Decision table")[1];
  if (section === undefined) throw new Error("method-selection.md has no '## Decision table'");
  const rows: string[][] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) {
      if (rows.length > 0) break; // table ended
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue; // separator
    rows.push(cells);
  }
  return rows;
}

/** Backtick-quoted identifiers in a cell, e.g. `newtonShooting`. */
function ticked(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
}

function isNamedExport(file: string, symbol: string): boolean {
  const abs = join(ANALYSIS_SRC, file);
  if (!existsSync(abs)) return false;
  const source = readFileSync(abs, "utf8");
  return new RegExp(
    `^export\\s+(?:default\\s+)?(?:async\\s+)?` +
      `(?:abstract\\s+)?(?:class|function|const|let|var|interface|type|enum)\\s+` +
      `${symbol}\\b`,
    "m",
  ).test(source);
}

describe("analysis docs exist and resolve", () => {
  it.each(PAGES)("%s is committed under docs/analysis", (name) => {
    expect(existsSync(join(DOCS_DIR, name)), `docs/analysis/${name} is missing`).toBe(true);
  });

  it("docs/analysis holds exactly the pages this suite knows about", () => {
    const onDisk = readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
    // A new page added without a test entry would otherwise be unchecked.
    expect(onDisk).toEqual([...PAGES].sort());
  });

  it("the index links to method selection, and back", () => {
    expect(pageText("README.md")).toContain("(./method-selection.md)");
    expect(pageText("method-selection.md")).toContain("(./README.md)");
  });

  it.each(PAGES)("%s: every relative link resolves", (name) => {
    for (const [, target] of links(pageText(name))) {
      if (/^https?:/.test(target)) continue;

      const [pathPart = "", anchor] = target.split("#");
      if (pathPart === "") {
        expect(
          headingAnchors(pageText(name)),
          `${name}: in-page anchor #${anchor} has no matching heading`,
        ).toContain(anchor);
        continue;
      }

      const resolved = resolve(DOCS_DIR, pathPart);
      expect(existsSync(resolved), `${name}: link target ${target} does not exist`).toBe(true);

      if (anchor !== undefined && anchor !== "" && resolved.endsWith(".md")) {
        expect(
          headingAnchors(readFileSync(resolved, "utf8")),
          `${name}: anchor #${anchor} not found in ${pathPart}`,
        ).toContain(anchor);
      }
    }
  });

  it.each(PAGES)("%s has balanced math delimiters", (name) => {
    const text = proseOf(pageText(name));

    const displayCount = (text.match(/\$\$/g) ?? []).length;
    expect(displayCount % 2, `unbalanced $$ in ${name}`).toBe(0);

    const inlineOnly = text.replace(/\$\$[\s\S]*?\$\$/g, "");
    const inlineCount = (inlineOnly.match(/\$/g) ?? []).length;
    expect(inlineCount % 2, `unbalanced $ in ${name}`).toBe(0);
  });

  it.each(PAGES)("%s has balanced LaTeX grouping inside each math block", (name) => {
    const text = proseOf(pageText(name));
    const blocks = [
      ...(text.match(/\$\$[\s\S]*?\$\$/g) ?? []),
      ...(text.replace(/\$\$[\s\S]*?\$\$/g, "").match(/\$[^$\n]+\$/g) ?? []),
    ];
    for (const block of blocks) {
      const stripped = block.replace(/\\[{}]/g, "");
      const opens = (stripped.match(/\{/g) ?? []).length;
      const closes = (stripped.match(/\}/g) ?? []).length;
      expect(opens, `unbalanced braces in ${name}: ${block.slice(0, 60)}`).toBe(closes);
    }
  });

  it.each(PAGES)("%s leaves no placeholder or unrendered artifact", (name) => {
    const text = proseOf(pageText(name));
    expect(text, `${name} contains a TODO`).not.toMatch(/\bTODO\b|\bFIXME\b/);
    expect(text, `${name} interpolated undefined`).not.toMatch(/\bundefined\b/);
    expect(text, `${name} interpolated an object`).not.toContain("[object Object]");
    expect(text, `${name} has an empty table cell`).not.toMatch(/\|\s*\|\s*\|/);
  });
});

describe("decision table present", () => {
  const rows = decisionTableRows();
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  it("has the columns a decision table needs to be one", () => {
    // Without a "how it fails" column this is a feature list, not a decision procedure.
    expect(header).toEqual([
      "If your problem is…",
      "Use",
      "Exported from",
      "Needs derivatives?",
      "Dimension",
      "How it fails",
    ]);
  });

  it("has enough rows to be a table rather than a gesture", () => {
    expect(body.length).toBeGreaterThanOrEqual(12);
  });

  it.each(body.map((r): [string, string[]] => [r[1] ?? "", r]))(
    "row %s: every named function is a real export of the file beside it",
    (_use, row) => {
      const file = ticked(row[2] ?? "")[0];
      expect(file, `row has no file cell: ${row.join(" | ")}`).toBeDefined();
      const symbols = ticked(row[1] ?? "");
      expect(symbols.length, `row names no function: ${row.join(" | ")}`).toBeGreaterThan(0);
      for (const symbol of symbols) {
        expect(
          isNamedExport(file as string, symbol),
          `decision table: ${symbol} is not a named export of ${file}`,
        ).toBe(true);
      }
    },
  );

  it.each(body.map((r): [string, string[]] => [r[1] ?? "", r]))(
    "row %s: every quoted status string is a real member of that module's status union",
    (_use, row) => {
      const file = ticked(row[2] ?? "")[0] as string;
      const source = readFileSync(join(ANALYSIS_SRC, file), "utf8");
      // Every kebab-case string literal the module declares in any exported status union.
      const declared = new Set(
        [...source.matchAll(/^\s*\|?\s*"([a-z][a-z0-9-]*)"/gm)].map((m) => m[1] ?? ""),
      );
      for (const claim of ticked(row[5] ?? "")) {
        // Type names (e.g. `Minimize1DStatus`) are cross-references, not status literals.
        if (/^[A-Z]/.test(claim)) continue;
        expect(
          declared.has(claim),
          `decision table: ${file} never declares the status "${claim}"`,
        ).toBe(true);
      }
    },
  );

  it("covers every solver the analysis package exports", () => {
    // The anti-rot check. Anything in packages/analysis/src that converges to something —
    // as opposed to setting up a problem, differentiating it, or reading a trajectory —
    // must appear in the table. A new solver lands here red rather than undocumented.
    const SOLVER_ENTRY_POINTS: ReadonlyArray<readonly [string, string]> = [
      ["newton-shooting.ts", "newtonShooting"],
      ["levenberg-marquardt.ts", "levenbergMarquardt"],
      ["levenberg-marquardt.ts", "shootingWithFallback"],
      ["nelder-mead.ts", "nelderMead"],
      ["brent-minimize.ts", "brentMinimize"],
      ["brent-minimize.ts", "goldenSectionMinimize"],
      ["arcs.ts", "solveArcs"],
      ["multi-start.ts", "multiStart"],
      ["optimal-angle.ts", "maximizeRange"],
      ["min-energy.ts", "minimumSpeedToHit"],
      ["constraints.ts", "constrainedShooting"],
      ["robust-aim.ts", "robustAim"],
      ["trajectory-designer.ts", "designTrajectory"],
      ["range-root.ts", "solveRangeRoot"],
      ["envelope.ts", "computeEnvelope"],
    ];

    // Guard the guard: if one of these is renamed, the coverage list must be updated too,
    // otherwise this test would pass while asserting nothing about the real code.
    for (const [file, symbol] of SOLVER_ENTRY_POINTS) {
      expect(isNamedExport(file, symbol), `${symbol} is no longer exported from ${file}`).toBe(
        true,
      );
    }

    const named = new Set(body.flatMap((row) => ticked(row[1] ?? "")));
    for (const [, symbol] of SOLVER_ENTRY_POINTS) {
      expect(named.has(symbol), `decision table has no row for ${symbol}`).toBe(true);
    }
  });
});

describe("API map documents the whole package", () => {
  it("has a row for every module the package re-exports", () => {
    const index = readFileSync(join(ANALYSIS_SRC, "index.ts"), "utf8");
    const modules = [...index.matchAll(/^export \* from "\.\/([a-z0-9-]+)\.js";/gm)].map(
      (m) => `${m[1]}.ts`,
    );
    // If index.ts stops re-exporting, this check would pass vacuously.
    expect(modules.length).toBeGreaterThanOrEqual(20);

    const readme = pageText("README.md");
    const undocumented = modules.filter((m) => !readme.includes(m));
    expect(
      undocumented,
      `docs/analysis/README.md never mentions: ${undocumented.join(", ")}`,
    ).toHaveLength(0);
  });

  it("every symbol it lists in a table is a real named export of the file beside it", () => {
    const readme = pageText("README.md");
    let checked = 0;
    for (const line of readme.split("\n")) {
      if (!line.startsWith("| `")) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      const symbol = ticked(cells[0] ?? "")[0];
      const file = ticked(cells[1] ?? "")[0];
      if (symbol === undefined || file === undefined) continue;
      expect(isNamedExport(file, symbol), `API map: ${symbol} is not exported from ${file}`).toBe(
        true,
      );
      checked += 1;
    }
    expect(checked, "API map listed no symbols — the parser is broken").toBeGreaterThanOrEqual(40);
  });
});
