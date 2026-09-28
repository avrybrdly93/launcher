// P0.160: every phase table's `Validation` cell is a copy of `ROADMAP.json`'s
// `validation` field, and nothing held the copies together.
//
// The hazard is silent in both directions. Edit a row's criterion and the
// blueprint keeps quoting the old sentence; edit the blueprint and the roadmap
// does. P0.131 (138th run) found it latent after enumerating five copies of
// P7.09's criterion by hand. P0.134 (141st run) ran it live: restating P7.14's
// and P7.16's criteria moved seven copies, exactly one of which was held by a
// test — that one went red the moment the string moved, which is how the rest
// were found, and the other six would have gone stale in silence.
//
// So this file asserts the two comparisons that criterion names:
//
//   1. `ballista-technical-blueprint.md`'s phase tables vs `ROADMAP.json`,
//      BYTE FOR BYTE. Not normalised — a normalising comparison passes through
//      most of the drift this exists to catch.
//   2. P7.09's two machine-readable copies: `scripts/simd-speedup-results.json`'s
//      `criterion` string, and `SIMD_SPEEDUP_CRITERION` in
//      `packages/wasm-core/src/simd-benchmark.ts`. Both are compared to the
//      roadmap line rather than to each other, so the roadmap stays the single
//      source the way `CHANGELOG.md`'s header says it is.
//
// ONE DIFFERENCE IS LEGITIMATE AND IS THEREFORE MADE EXPLICIT RATHER THAN
// NORMALISED AWAY. The roadmap and the blueprint write `≥` and `×`; the results
// JSON is written by a script into an ASCII field and says `>=` and `x`. That
// transliteration is asserted as a named, tested function below, so a copy that
// differs in any OTHER character still fails. A silent `normalise()` on both
// sides would have swallowed the P7.03 and P7.05 drift this file found on its
// first run.
//
// WHAT THIS FILE IS NOT FOR. P0.160's own note: "DO NOT use this task as cover
// for editing any criterion's text ... this row is about the copies agreeing,
// not about what they say." When this goes red the fix is to bring the stale
// COPY into line with `ROADMAP.json`, never the reverse.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROADMAP_PATH = join(REPO_ROOT, "ROADMAP.json");
const BLUEPRINT_PATH = join(REPO_ROOT, "ballista-technical-blueprint.md");
const SIMD_RESULTS_PATH = join(REPO_ROOT, "scripts", "simd-speedup-results.json");
const SIMD_BENCHMARK_PATH = join(REPO_ROOT, "packages", "wasm-core", "src", "simd-benchmark.ts");

interface RoadmapTask {
  id: string;
  seq: number;
  phase: number;
  validation?: string;
}

const roadmap = JSON.parse(readFileSync(ROADMAP_PATH, "utf8")) as { tasks: RoadmapTask[] };
const blueprintText = readFileSync(BLUEPRINT_PATH, "utf8");

const roadmapById = new Map(roadmap.tasks.map((t) => [t.id, t]));

/**
 * A blueprint phase-table row: `| P7.09 | title | 30m | H | validation |`.
 *
 * THIS CANNOT BE A SPLIT ON `|`. Seven rows carry an unescaped pipe inside a
 * cell — `Guard drag at |v_rel|→0`, `soccer preset: |F_b|/|F_g| ≈ 1.0–1.6%`,
 * `|R(z)|=1 contours` among them — so the delimiter appears in the data and a
 * split mis-columns exactly those rows, comparing an estimate against a
 * criterion and reporting a mismatch that is the parser's own. The estimate
 * (`\d+m`) and difficulty (`E`/`M`/`H`) columns have a fixed shape, so anchor
 * on those and let the title and validation cells hold whatever they hold.
 */
const TABLE_ROW = /^\|\s*(P\d+\.\d+)\s*\|(.*?)\|\s*(\d+m)\s*\|\s*([EMH])\s*\|(.*)\|\s*$/;

/** Any line that opens like a task row, parseable or not — see the vacuity guard. */
const TABLE_ROW_OPENER = /^\|\s*P\d+\.\d+\s*\|/;

interface BlueprintRow {
  id: string;
  line: number;
  validation: string;
}

function parseBlueprintRows(text: string): { rows: BlueprintRow[]; unparsed: string[] } {
  const rows: BlueprintRow[] = [];
  const unparsed: string[] = [];
  text.split("\n").forEach((line, index) => {
    if (!TABLE_ROW_OPENER.test(line)) return;
    const match = TABLE_ROW.exec(line);
    if (match === null) {
      unparsed.push(`${BLUEPRINT_PATH}:${index + 1}: ${line}`);
      return;
    }
    const [, id, , , , validation] = match;
    // Both groups are non-optional in TABLE_ROW, so a match guarantees them;
    // the guard is for `noUncheckedIndexedAccess` rather than for a real case.
    if (id === undefined || validation === undefined) {
      unparsed.push(`${BLUEPRINT_PATH}:${index + 1}: ${line}`);
      return;
    }
    rows.push({ id, line: index + 1, validation: validation.trim() });
  });
  return { rows, unparsed };
}

const { rows: blueprintRows, unparsed } = parseBlueprintRows(blueprintText);

/**
 * The ASCII form a script writes into a results artefact. Exported shape rather
 * than an inline `.replace()` chain so the test below can assert the mapping is
 * a *transliteration* — same characters otherwise — instead of a general
 * normaliser that would hide real differences.
 */
function toAsciiCriterion(text: string): string {
  return text.replaceAll("≥", ">=").replaceAll("≤", "<=").replaceAll("×", "x");
}

function roadmapValidation(id: string): string {
  const task = roadmapById.get(id);
  expect(task, `${id} has no row in ROADMAP.json`).toBeDefined();
  const validation = task?.validation;
  expect(typeof validation, `${id} has no validation field in ROADMAP.json`).toBe("string");
  return validation as string;
}

describe("phase-table criteria agree with ROADMAP.json", () => {
  it("found rows to check at all", () => {
    // Vacuity guard. Every assertion below is over `blueprintRows`, so a
    // regex that stops matching would turn this whole file into a no-op that
    // reports success — the failure mode P0.160 exists to prevent, reproduced
    // inside its own test.
    expect(blueprintRows.length).toBeGreaterThan(280);
  });

  it("parses every line that opens like a task row", () => {
    // A row the regex cannot read is not skipped quietly: an unparsed row is
    // an unchecked criterion, which is indistinguishable from an agreeing one
    // unless this fails. Adding a column, or an `Est` that is not `\d+m`,
    // lands here rather than silently shrinking the checked set.
    expect(unparsed).toEqual([]);
  });

  it("names only tasks that exist in ROADMAP.json", () => {
    // The blueprint's ids must be a subset of the roadmap's. The other
    // direction is not a defect: 73 roadmap rows are discovered-bug filings
    // (P0.90 and up) that exist only there, by design.
    const orphans = blueprintRows
      .filter((row) => !roadmapById.has(row.id))
      .map((row) => `${row.id} (blueprint line ${row.line})`);
    expect(orphans).toEqual([]);
  });

  it("quotes each criterion byte for byte", () => {
    // The comparison is exact on purpose. `≥` vs `>=`, a trailing period, a
    // dropped parenthetical — every one of those is drift, and every one of
    // them survives a normalising compare.
    const drift = blueprintRows
      .filter((row) => roadmapById.has(row.id))
      .filter((row) => row.validation !== roadmapValidation(row.id))
      .map(
        (row) =>
          `${row.id} (blueprint line ${row.line})\n` +
          `  blueprint: ${row.validation}\n` +
          `  ROADMAP.json: ${roadmapValidation(row.id)}`,
      );
    expect(drift).toEqual([]);
  });
});

describe("P7.09's machine-readable copies agree with ROADMAP.json", () => {
  const criterion = roadmapValidation("P7.09");

  it("transliterates to ASCII without changing anything else", () => {
    // Pins the one legitimate difference. If this ever has to grow a third
    // substitution, that is a decision somebody makes here, in a diff, rather
    // than a normaliser quietly widening.
    expect(toAsciiCriterion("≥1.8× ≤2")).toBe(">=1.8x <=2");
    expect(toAsciiCriterion("no special glyphs")).toBe("no special glyphs");
    // Length changes only by the two-character expansions, which is what makes
    // this a transliteration rather than a reformat.
    expect(toAsciiCriterion(criterion).replaceAll(">=", "≥").replaceAll("x ", "× ")).toBe(
      criterion,
    );
  });

  it("matches scripts/simd-speedup-results.json's criterion field", () => {
    const results = JSON.parse(readFileSync(SIMD_RESULTS_PATH, "utf8")) as {
      task: string;
      criterion: string;
    };
    expect(results.task).toBe("P7.09");
    expect(results.criterion).toBe(toAsciiCriterion(criterion));
  });

  it("matches SIMD_SPEEDUP_CRITERION, parsed out of the roadmap line", () => {
    // The constant is compared to the NUMBER IN THE SENTENCE, not to a literal
    // repeated here. simd-benchmark.test.ts already pins the constant to 1.8
    // with a comment saying "if a later session wants a different number it has
    // to change the task, not the code" — this is the half of that invariant
    // that reads the task.
    const threshold = /(\d+(?:\.\d+)?)×/.exec(criterion);
    expect(threshold, `no '<number>×' threshold in P7.09's criterion: ${criterion}`).not.toBeNull();

    const source = readFileSync(SIMD_BENCHMARK_PATH, "utf8");
    const declared = /export const SIMD_SPEEDUP_CRITERION = (\d+(?:\.\d+)?);/.exec(source);
    expect(
      declared,
      "SIMD_SPEEDUP_CRITERION is not declared in the shape this test reads",
    ).not.toBeNull();

    expect(Number(declared?.[1])).toBe(Number(threshold?.[1]));
  });
});
