// P0.110 regression guard: `pnpm verify` must be the pre-push gate, step for
// step against `.github/workflows/ci.yml`.
//
// Why this file exists. CLAUDE.md told every session to run "the project's
// typecheck/lint/test suite locally" and then named four commands —
// `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm test`, plus a vague
// "build". `ci.yml` runs eleven. So a session could run every documented check,
// see green, push, and land red — which is what happened at a7f09b9, on the two
// typedoc steps, because typedoc is configured to fail on warnings and an
// exported type inferred from an unexported const trips it. Format, Build app
// and Bundle size budget were missing from the documented gate too; the task
// title only names the typedoc pair because those are what bit first.
//
// The fix is not a longer list in CLAUDE.md. A list in prose is exactly the
// thing that drifted: `ci.yml` gains a step, nobody thinks to edit the
// documentation, and the gap is invisible until it costs someone a red build.
// So the gate is now the `verify` script — one place, executable — and this
// file is the assertion that the script and the workflow have not diverged.
//
// WHAT IS DELIBERATELY EXCLUDED, and why the exclusions are a list here rather
// than a judgement call at each reading: two of CI's steps provision the
// environment rather than check the tree, and running them from a pre-push gate
// would be wrong, not merely slow. `pnpm install --frozen-lockfile` on a
// developer's machine either no-ops or rewrites their node_modules from the
// lockfile mid-session; `playwright install` downloads browsers, which is a
// once-per-machine act. Each is named below with its reason, so a third
// omission cannot be added without someone writing down why.
//
// These are string assertions over two files, not an execution of the gate. The
// failure mode being guarded is drift between two lists, and that is precisely
// what a string assertion catches — running the real gate here would take
// minutes and would not detect a *missing* step at all.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CI_WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const CLAUDE_MD_PATH = join(REPO_ROOT, "CLAUDE.md");

/**
 * CI steps the gate deliberately does not run, each with the reason it is
 * environment provisioning rather than a check on the tree. Keyed by the exact
 * `run:` command in ci.yml.
 */
const DELIBERATE_OMISSIONS: Record<string, string> = {
  "pnpm install --frozen-lockfile":
    "provisions node_modules; a developer running the gate already has one, and re-running it mid-session rewrites their tree from the lockfile",
  "pnpm exec playwright install --with-deps chromium firefox":
    "downloads browsers; a once-per-machine act, not a per-push check",
};

/**
 * Commands the gate runs in a deliberately different form from CI, with the
 * reason. The value is the form the gate uses.
 */
const DELIBERATE_VARIANTS: Record<string, { gateForm: string; why: string }> = {
  "pnpm check:cross-engine-drift --record": {
    gateForm: "pnpm check:cross-engine-drift",
    why: "ci.yml passes --record because the runner is the one environment with real browsers, and says in its own comment that a local gate run should measure without writing; the write lands in the runner's workspace and is discarded either way",
  },
};

/**
 * Every `run:` command in ci.yml, in file order.
 *
 * Parsed with a regex rather than a YAML library on purpose: adding a YAML
 * parser to `@ballista/validation` for one test is a runtime dependency the
 * repo does not otherwise need, and the shape being read is one line per step.
 * The parser handles both `- run: cmd` and the `run: cmd` that follows a
 * `- name:` line, which is every form ci.yml currently uses. If ci.yml ever
 * grows a block scalar (`run: |`), the assertion below fails loudly on the
 * empty command rather than silently skipping the step.
 */
function ciRunCommands(): string[] {
  const workflow = readFileSync(CI_WORKFLOW_PATH, "utf8");
  const commands: string[] = [];
  for (const line of workflow.split("\n")) {
    const match = /^\s*(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (match === null) continue;
    // `?? ""` rather than a non-null assertion: the group is not optional in
    // the pattern, so this is unreachable, and an empty command is exactly what
    // `parses every ci.yml step as a non-empty command` below fails on. A
    // wrong assumption about the regex should surface as that assertion, not as
    // a crash inside the parser.
    commands.push(canonical((match[1] ?? "").trim()));
  }
  return commands;
}

/**
 * `--flag value` and `--flag=value` are the same command to pnpm whenever the
 * value is actually present, and the two files are required to write them
 * differently.
 *
 * `ci.yml` uses the space form (`pnpm --filter @ballista/engine run docs`).
 * `package.json` cannot: `root-scripts.test.ts` rejects a space-separated
 * value-flag in any root script, because pnpm 11 folds the following token
 * into the flag's value when the value is missing — the P0.90 defect, where
 * `--workspace-concurrency 1 run build` made `run` the script name. That guard
 * is over-broad for `--filter`, whose value is present, but it is over-broad in
 * the safe direction and this file will not weaken it to make a comparison
 * easier. Canonicalising here is the cheaper and more honest fix: the gate uses
 * the `=` form the other guard requires, and the comparison sees through the
 * difference rather than being told to ignore it.
 *
 * Only `--filter` is rewritten, deliberately. A general "any `--flag value`
 * becomes `--flag=value`" rule is wrong: `--with-deps chromium firefox` takes a
 * *list*, and canonicalising it would produce `--with-deps=chromium firefox`,
 * a command that means something else. Extend this list when a second flag
 * actually needs it, not in anticipation.
 */
const SPACE_FORM_FLAGS = ["--filter"];

function canonical(command: string): string {
  let out = command;
  for (const flag of SPACE_FORM_FLAGS) {
    out = out.replace(new RegExp(`${flag} (?=[^\\s=])`, "g"), `${flag}=`);
  }
  return out;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

const rootPkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageJson;
const verifyScript = rootPkg.scripts?.verify ?? "";
const verifySteps = verifyScript
  .split("&&")
  .map((step) => canonical(step.trim()))
  .filter((step) => step.length > 0);

describe("pre-push gate", () => {
  it("defines a verify script", () => {
    expect(verifyScript, "root package.json must define a `verify` script").not.toEqual("");
  });

  it("parses every ci.yml step as a non-empty command", () => {
    const commands = ciRunCommands();
    expect(commands.length, "ci.yml should declare run: steps").toBeGreaterThan(0);
    // A block scalar (`run: |`) parses to an empty string here. That is a
    // parse gap rather than a workflow error, and it must fail rather than
    // silently drop the step from the comparison below.
    expect(
      commands.filter((c) => c === ""),
      "ci.yml has a `run:` this test cannot read as a single command (a block scalar?); teach the parser rather than ignoring the step",
    ).toEqual([]);
  });

  it("runs every checking step ci.yml runs", () => {
    const missing: string[] = [];
    for (const command of ciRunCommands()) {
      if (command in DELIBERATE_OMISSIONS) continue;
      const variant = DELIBERATE_VARIANTS[command];
      const expected = variant === undefined ? command : variant.gateForm;
      if (!verifySteps.includes(expected)) missing.push(command);
    }
    expect(
      missing,
      "these ci.yml steps are not in `pnpm verify`; add them to the script, or add them to DELIBERATE_OMISSIONS with the reason they are environment rather than a check",
    ).toEqual([]);
  });

  it("runs its steps in ci.yml's order, so the first local failure is the first CI failure", () => {
    // Ordering is not cosmetic here. `pnpm test` needs packages/engine/dist,
    // which `pnpm typecheck` emits as a side effect of `tsc -b` over composite
    // projects — the undeclared edge P0.111 is filed for. CI is green because
    // it happens to run Typecheck first; the gate must not be free to reorder
    // into a form that reproduces P0.111's failure.
    const gatePositions = ciRunCommands()
      .filter((command) => !(command in DELIBERATE_OMISSIONS))
      .map((command) => {
        const variant = DELIBERATE_VARIANTS[command];
        return verifySteps.indexOf(variant === undefined ? command : variant.gateForm);
      })
      .filter((index) => index >= 0);

    const sorted = [...gatePositions].sort((a, b) => a - b);
    expect(gatePositions, "`pnpm verify` runs ci.yml's steps out of order").toEqual(sorted);
  });

  it("adds no step of its own that ci.yml does not run", () => {
    // The gate over-covering is a milder failure than under-covering, but it
    // still breaks the contract this file exists to state: green locally means
    // what green on CI means. A step only the gate runs makes local red on a
    // tree CI would accept.
    const ciCommands = new Set(ciRunCommands());
    const gateForms = new Map(
      Object.entries(DELIBERATE_VARIANTS).map(([ciForm, v]) => [v.gateForm, ciForm]),
    );
    const extra = verifySteps.filter((step) => {
      if (ciCommands.has(step)) return false;
      const ciForm = gateForms.get(step);
      return ciForm === undefined || !ciCommands.has(ciForm);
    });
    expect(extra, "`pnpm verify` runs steps ci.yml does not").toEqual([]);
  });

  it("names each omission with a reason rather than leaving it implicit", () => {
    for (const [command, reason] of Object.entries(DELIBERATE_OMISSIONS)) {
      expect(reason.length, `omission of \`${command}\` needs a reason`).toBeGreaterThan(20);
    }
    for (const [command, variant] of Object.entries(DELIBERATE_VARIANTS)) {
      expect(variant.why.length, `variant form of \`${command}\` needs a reason`).toBeGreaterThan(
        20,
      );
    }
  });

  it("keeps every declared omission and variant real, so the lists cannot rot", () => {
    // An entry that no longer matches anything in ci.yml is worse than no
    // entry: it reads as a documented decision while silently exempting
    // nothing, and it would hide the day that step comes back under a new name.
    const ciCommands = new Set(ciRunCommands());
    const stale = [
      ...Object.keys(DELIBERATE_OMISSIONS),
      ...Object.keys(DELIBERATE_VARIANTS),
    ].filter((command) => !ciCommands.has(command));
    expect(stale, "these entries name a ci.yml step that no longer exists").toEqual([]);
  });

  it("is what CLAUDE.md points at, instead of a command list that drifts", () => {
    const claudeMd = readFileSync(CLAUDE_MD_PATH, "utf8");
    expect(claudeMd, "CLAUDE.md must name `pnpm verify` as the gate").toContain("pnpm verify");

    // The specific regression: CLAUDE.md naming a subset of the gate's steps
    // inline, which is what went stale. The gate's own steps are allowed to
    // appear in prose about *why* something is excluded (the cross-engine-drift
    // note), so this checks for the two commands that were in the old list and
    // are not otherwise discussed.
    for (const stale of ["`pnpm typecheck`", "`pnpm lint:deps`"]) {
      expect(
        claudeMd,
        `CLAUDE.md lists ${stale} inline again; the point of P0.110 is that the list belongs in package.json, not in prose`,
      ).not.toContain(stale);
    }
  });
});
