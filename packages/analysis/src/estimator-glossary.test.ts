/**
 * P6.30's guard. The when-to-use table is guidance, and guidance that has
 * quietly stopped describing the code is worse than none — it reads exactly
 * like guidance that still works.
 *
 * So nothing here checks the table against itself. Every assertion below
 * checks a row against the repository: the module it names, the export it
 * names, the test it credits, and the numbers it quotes. A rename, a move, or
 * a re-recorded measurement fails one of these rather than leaving a plausible
 * sentence in the dashboard.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ESTIMATOR_GLOSSARY,
  ESTIMATOR_GLOSSARY_ADR,
  estimatorGlossaryEntry,
  type EstimatorGlossaryEntry,
} from "./estimator-glossary.js";

/** Repository root, four levels up from `packages/analysis/src`. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const read = (repoRelative: string): string => readFileSync(join(REPO_ROOT, repoRelative), "utf8");

/**
 * The measured claims, split out of the prose so each can be checked against
 * the file that recorded it. A figure is quoted here in the exact spelling the
 * test uses, because a number the citing prose rounded differently is a number
 * this guard cannot find.
 */
const QUOTED_FIGURES: Readonly<Record<EstimatorGlossaryEntry["id"], readonly string[]>> = {
  "monte-carlo": ["-0.65", "-0.35", "-0.85"],
  "latin-hypercube": ["6.037", "0.410", "0.068", "1.10"],
  "quasi-monte-carlo": ["-0.85", "-0.65", "-0.35"],
  "control-variate": ["0.00115", "0.99952", "0.994"],
  "importance-sampling": ["1.59109e-4", "6.28e5", "3.6-sigma"],
};

describe("the estimator glossary describes the repository it ships with (P6.30)", () => {
  it("carries exactly the five methods the task names, with unique ids", () => {
    expect(ESTIMATOR_GLOSSARY.map((entry) => entry.abbreviation)).toEqual([
      "MC",
      "LHS",
      "QMC",
      "CV",
      "IS",
    ]);
    expect(new Set(ESTIMATOR_GLOSSARY.map((entry) => entry.id)).size).toBe(
      ESTIMATOR_GLOSSARY.length,
    );
  });

  for (const entry of ESTIMATOR_GLOSSARY) {
    describe(`${entry.abbreviation} — ${entry.name}`, () => {
      it("names a module that exists and really exports its entry point", () => {
        expect(existsSync(join(REPO_ROOT, entry.module))).toBe(true);
        const source = read(entry.module);
        // Matches `export function foo`, `export const foo`, `export function*
        // foo` — the forms these modules actually use — and not a mention of
        // the name in a comment, which is what a bare `toContain` would accept.
        expect(source).toMatch(
          new RegExp(String.raw`^export (?:function\*? |const |class )${entry.entryPoint}\b`, "m"),
        );
      });

      it("credits a validation test that exists", () => {
        expect(existsSync(join(REPO_ROOT, entry.measuredIn))).toBe(true);
      });

      it("quotes only figures that appear in that test", () => {
        const measuringTest = read(entry.measuredIn);
        for (const figure of QUOTED_FIGURES[entry.id]) {
          expect(measuringTest, `${entry.abbreviation} quotes ${figure}`).toContain(figure);
        }
      });

      it("quotes those figures in its own prose, so the guard above is guarding something", () => {
        // Without this the figure list could drift away from `measured` and
        // every check would still pass while the table said something else.
        for (const figure of QUOTED_FIGURES[entry.id]) {
          expect(entry.measured, `${entry.abbreviation} prose quotes ${figure}`).toContain(figure);
        }
      });

      it("states a precondition and a failure mode, not only a recommendation", () => {
        // A row that says when to reach for a method and never when not to is
        // an advertisement. Every row here has to carry both halves.
        expect(entry.useWhen.length).toBeGreaterThan(40);
        expect(entry.avoidWhen.length).toBeGreaterThan(40);
        expect(entry.estimates.length).toBeGreaterThan(20);
        expect(entry.errorBehaviour.length).toBeGreaterThan(20);
      });
    });
  }

  it("distinguishes the rows rather than repeating one recommendation five times", () => {
    // The table's content is the contrast between rows. Identical guidance in
    // two of them would mean it had stopped carrying any.
    for (const field of ["useWhen", "avoidWhen", "errorBehaviour"] as const) {
      const values = ESTIMATOR_GLOSSARY.map((entry) => entry[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("looks a row up by id, and reports an unknown id as undefined rather than guessing", () => {
    expect(estimatorGlossaryEntry("importance-sampling")?.abbreviation).toBe("IS");
    expect(estimatorGlossaryEntry("not-an-estimator")).toBeUndefined();
  });
});

describe("ADR-019 and the table cannot drift apart (P6.30)", () => {
  const adr = () => read(ESTIMATOR_GLOSSARY_ADR);

  it("exists at the path the table publishes, which is the path the dashboard links", () => {
    expect(existsSync(join(REPO_ROOT, ESTIMATOR_GLOSSARY_ADR))).toBe(true);
  });

  it("is an accepted ADR that names its task", () => {
    expect(adr()).toMatch(/^# ADR-019:/m);
    expect(adr()).toContain("**Status:** Accepted");
    expect(adr()).toContain("P6.30");
  });

  it("documents every row, by name and by implementing module", () => {
    for (const entry of ESTIMATOR_GLOSSARY) {
      expect(adr(), `${entry.abbreviation} is named`).toContain(entry.name);
      expect(adr(), `${entry.abbreviation} cites its module`).toContain(entry.module);
    }
  });

  it("documents no sixth method under a heading the table does not carry", () => {
    // The ADR is allowed to discuss antithetic variates and the rest in prose;
    // what it may not do is add a row to the when-to-use table that nothing
    // implements. The table is delimited so this can be checked.
    const table = adr()
      .split("<!-- when-to-use:start -->")[1]
      ?.split("<!-- when-to-use:end -->")[0];
    expect(table).toBeDefined();
    const rowNames = [...(table ?? "").matchAll(/^\| \*\*(.+?)\*\*/gm)].map((match) => match[1]);
    expect(rowNames).toEqual(ESTIMATOR_GLOSSARY.map((entry) => entry.abbreviation));
  });
});
