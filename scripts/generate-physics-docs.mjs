#!/usr/bin/env node
// P4.40: regenerate docs/physics/*.md from the blueprint's Section 3 sources.
//
// The blueprint (ballista-technical-blueprint.md) is the source of truth for architecture and
// is never edited by this script — Section 3's prose is copied through verbatim. What the
// generator adds around it is navigation, provenance, and the implementation map from
// docs/physics/implementation-map.json, so the pages can be regenerated at will without
// losing the equation -> code correspondence.
//
//   node scripts/generate-physics-docs.mjs          # write the pages
//   node scripts/generate-physics-docs.mjs --check  # exit 1 if any page is out of date
//
// packages/validation/src/physics-docs.test.ts runs the --check path plus the render and
// cross-link assertions that make up P4.40's validation criterion.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLUEPRINT = "ballista-technical-blueprint.md";
const OUT_DIR = join(REPO_ROOT, "docs", "physics");
const MAP_PATH = join(OUT_DIR, "implementation-map.json");

/** Slug used for each subsection's filename, keyed by blueprint number. */
const SLUGS = {
  3.1: "newtonian-formulation",
  3.2: "gravity",
  3.3: "drag",
  3.4: "atmosphere",
  3.5: "wind",
  3.6: "magnus-and-spin",
  3.7: "state-vector",
  3.8: "system-properties",
  3.9: "projectile-and-scenario-database",
};

/**
 * Slice Section 3 out of the blueprint and split it into its `## 3.N` subsections.
 * Returns [{ number, title, body }] in document order.
 */
export function extractSection3(blueprintText) {
  const lines = blueprintText.split("\n");
  const start = lines.findIndex((l) => /^# 3\. Physics Modeling Framework\s*$/.test(l));
  if (start === -1) throw new Error("Section 3 heading not found in the blueprint");
  let end = lines.findIndex((l, i) => i > start && /^# 4\. /.test(l));
  if (end === -1) end = lines.length;

  const sections = [];
  let current = null;
  for (const line of lines.slice(start + 1, end)) {
    const m = /^## (3\.\d+) (.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { number: m[1], title: m[2], body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.map((s) => ({ ...s, body: s.body.join("\n").replace(/^\n+|\s+$/g, "") }));
}

function implementationTable(entries) {
  if (!entries || entries.length === 0) return "";
  const rows = entries
    .map((e) => `| \`${e.symbol}\` | [\`${e.file}\`](../../${e.file}) | ${e.note} |`)
    .join("\n");
  return [
    "## Implementation",
    "",
    "Where this section's model lives in the codebase. Every row is checked by",
    "[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts):",
    "the file must exist and the symbol must be a named export of it.",
    "",
    "| Symbol | Source | Role |",
    "| --- | --- | --- |",
    rows,
    "",
  ].join("\n");
}

function renderPage(section, prev, next, entries) {
  const header = [
    `<!-- GENERATED FILE — DO NOT EDIT BY HAND.`,
    `     Source: ${BLUEPRINT} §${section.number}`,
    `     Regenerate: node scripts/generate-physics-docs.mjs`,
    `     The prose below is copied verbatim from the blueprint, which stays the`,
    `     source of truth for architecture. Edit the blueprint, then regenerate. -->`,
    "",
    `# §${section.number} ${section.title}`,
    "",
    `> Regenerated from [\`${BLUEPRINT}\`](../../${BLUEPRINT}) §${section.number}.`,
    `> Physics reference index: [\`docs/physics/README.md\`](./README.md).`,
    "",
  ].join("\n");

  const nav = [];
  if (prev) nav.push(`← [§${prev.number} ${prev.title}](./${SLUGS[prev.number]}.md)`);
  nav.push("[Index](./README.md)");
  if (next) nav.push(`[§${next.number} ${next.title}](./${SLUGS[next.number]}.md) →`);

  return [
    header,
    section.body,
    "",
    implementationTable(entries),
    "---",
    "",
    nav.join(" · "),
    "",
  ].join("\n");
}

function renderIndex(sections) {
  const rows = sections
    .map((s) => `| §${s.number} | [${s.title}](./${SLUGS[s.number]}.md) |`)
    .join("\n");
  return [
    `<!-- GENERATED FILE — DO NOT EDIT BY HAND.`,
    `     Source: ${BLUEPRINT} §3`,
    `     Regenerate: node scripts/generate-physics-docs.mjs -->`,
    "",
    "# Physics reference",
    "",
    `The platform's physics model, regenerated from [\`${BLUEPRINT}\`](../../${BLUEPRINT}) §3.`,
    "The blueprint is the source of truth: **edit it, then regenerate these pages** with",
    "`node scripts/generate-physics-docs.mjs`. Editing a page directly will be overwritten,",
    "and the drift is caught by",
    "[`packages/validation/src/physics-docs.test.ts`](../../packages/validation/src/physics-docs.test.ts).",
    "",
    "Each page carries an **Implementation** table mapping the section's equations to the",
    "engine symbols that realize them; those links are machine-checked too.",
    "",
    "| Section | Page |",
    "| --- | --- |",
    rows,
    "",
    "## Related",
    "",
    "- [Architecture Decision Records](../adr) — including",
    "  [ADR-015](../adr/ADR-015-rotational-dynamics-scope.md), which scopes rigid-body attitude",
    "  out of the projectile models described here.",
    "- The numerical methods that consume these models live in blueprint §4.",
    "",
  ].join("\n");
}

/** Build the full {relativePath: contents} set the docs directory should contain. */
export function buildPages(blueprintText, map) {
  const sections = extractSection3(blueprintText);
  const missing = sections.filter((s) => !SLUGS[s.number]);
  if (missing.length > 0) {
    throw new Error(
      `Section 3 gained subsections with no slug: ${missing.map((s) => s.number).join(", ")}. ` +
        `Add them to SLUGS in scripts/generate-physics-docs.mjs.`,
    );
  }

  const pages = {};
  sections.forEach((s, i) => {
    pages[`${SLUGS[s.number]}.md`] = renderPage(
      s,
      sections[i - 1],
      sections[i + 1],
      map.sections[s.number],
    );
  });
  pages["README.md"] = renderIndex(sections);
  return pages;
}

export function loadInputs() {
  return {
    blueprintText: readFileSync(join(REPO_ROOT, BLUEPRINT), "utf8"),
    map: JSON.parse(readFileSync(MAP_PATH, "utf8")),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const { blueprintText, map } = loadInputs();
  const pages = buildPages(blueprintText, map);

  mkdirSync(OUT_DIR, { recursive: true });

  if (check) {
    const onDisk = new Set(readdirSync(OUT_DIR).filter((f) => f.endsWith(".md")));
    const problems = [];
    for (const [name, contents] of Object.entries(pages)) {
      let actual = null;
      try {
        actual = readFileSync(join(OUT_DIR, name), "utf8");
      } catch {
        problems.push(`missing: docs/physics/${name}`);
        continue;
      }
      if (actual !== contents) problems.push(`out of date: docs/physics/${name}`);
      onDisk.delete(name);
    }
    for (const stale of onDisk) problems.push(`stale (not generated): docs/physics/${stale}`);
    if (problems.length > 0) {
      console.error("physics docs are out of sync with the blueprint:\n  " + problems.join("\n  "));
      console.error("\nrun: node scripts/generate-physics-docs.mjs");
      process.exit(1);
    }
    console.log(`physics docs up to date (${Object.keys(pages).length} pages)`);
    return;
  }

  for (const [name, contents] of Object.entries(pages)) {
    writeFileSync(join(OUT_DIR, name), contents);
  }
  console.log(`wrote ${Object.keys(pages).length} pages to docs/physics/`);
}

if (process.argv[1] && process.argv[1].endsWith("generate-physics-docs.mjs")) {
  main();
}
