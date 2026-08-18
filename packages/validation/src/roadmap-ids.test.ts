// P0.100 regression guard: task identity in ROADMAP.json.
//
// Why this file exists. `ROADMAP.json` is the authoritative per-task record —
// `policy.commitRules` requires a task's status to be updated in the same commit
// as its code change, and CHANGELOG.md defers to it rather than restating it. So
// an id is not decoration; it is the key every changelog entry, commit message
// and session handover uses to name a piece of work.
//
// It was not unique. Discovered-bug filings are appended with ids `P0.90`,
// `P0.91`, ... and the counter rolled `P0.99` -> `P1.00` -> `P1.01`. But `P1.01`
// and `P1.02` are real phase-1 blueprint tasks at seq 12 and 13, so `P1.01`
// named two different tasks at once: "Define ChannelMeta, Params, Schema types"
// and "Root pnpm build script is broken under pnpm 11". Anything looking a task
// up by id got whichever it found first, silently — which is why the 28th run's
// roadmap edit had to disambiguate on `seq >= 288` instead.
//
// The collision was found by hand, twice, while doing something else. These
// assertions are the missing signal, and they are cheap: reading and validating
// one JSON file, no build, no fixture.
//
// The deepest of them is not uniqueness but PHASE AGREEMENT — that the `<phase>`
// component of `P<phase>.<n>` equals the task's own `phase` field. Both strays
// declared `"phase": 0` while wearing a phase-1 id, so that check would have
// failed the moment either was filed, whereas plain uniqueness only failed later
// when the second collision happened to land. It is the invariant; uniqueness is
// a consequence of it plus per-phase minor uniqueness.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROADMAP_PATH = join(REPO_ROOT, "ROADMAP.json");

interface RoadmapTask {
  id: string;
  phase: number;
  seq: number;
  title: string;
  status: string;
}

interface Roadmap {
  policy?: { taskIds?: string[] };
  tasks: RoadmapTask[];
}

const roadmap = JSON.parse(readFileSync(ROADMAP_PATH, "utf8")) as Roadmap;
const tasks = roadmap.tasks;

/** `P<phase>.<minor>` — the only id shape this repo uses. */
const ID_SHAPE = /^P(\d+)\.(\d+)$/;

/**
 * Minors at or above this are reserved for discovered-bug filings, which are
 * appended over time; blueprint tasks number upward from 1. The gap is what
 * keeps an appended filing from ever landing on a blueprint task's id, and it
 * is why the counter must run P0.99 -> P0.100 rather than P0.99 -> P1.00.
 */
const FILING_MINOR_FLOOR = 90;

function duplicates<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const dupes = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

describe("ROADMAP.json task identity", () => {
  it("has tasks to check at all", () => {
    // Guards against the whole suite passing vacuously if the file's shape
    // changes — every assertion below is over `tasks`.
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(280);
  });

  it("gives every task an id of the form P<phase>.<minor>", () => {
    const malformed = tasks.filter((t) => !ID_SHAPE.test(t.id)).map((t) => `${t.seq}: ${t.id}`);
    expect(malformed).toEqual([]);
  });

  it("never uses the same id for two tasks", () => {
    // The P0.100 defect, stated directly. The message carries the colliding
    // titles because "P1.01 is duplicated" is not enough to act on.
    const dupes = duplicates(tasks.map((t) => t.id));
    const detail = dupes.map((id) => {
      const both = tasks.filter((t) => t.id === id).map((t) => `seq ${t.seq} (phase ${t.phase})`);
      return `${id}: ${both.join(" and ")}`;
    });
    expect(detail).toEqual([]);
  });

  it("never uses the same seq for two tasks", () => {
    // Same class of bug on the other key. `seq` is what task selection orders
    // by, so a duplicate makes "the first task by seq" ambiguous.
    expect(duplicates(tasks.map((t) => t.seq))).toEqual([]);
  });

  it("agrees with itself about which phase a task is in", () => {
    // The invariant that would have caught P0.100 at filing time rather than
    // two runs later: `P1.00` and `P1.01` both declared "phase": 0.
    const mismatched = tasks
      .filter((t) => {
        const match = ID_SHAPE.exec(t.id);
        return match !== null && Number(match[1]) !== t.phase;
      })
      .map((t) => `${t.id} declares phase ${t.phase}`);
    expect(mismatched).toEqual([]);
  });

  it("never reuses a minor within a phase", () => {
    // Uniqueness of ids restated per phase, which is the form a filing can
    // actually violate: an appended P0.x lands in the same namespace as every
    // earlier P0.x.
    const perPhase = new Map<number, string[]>();
    for (const t of tasks) {
      const minor = ID_SHAPE.exec(t.id)?.[2];
      if (minor === undefined) continue;
      const list = perPhase.get(t.phase) ?? [];
      list.push(minor);
      perPhase.set(t.phase, list);
    }
    for (const [phase, minors] of perPhase) {
      expect(duplicates(minors), `phase ${phase} reuses a minor`).toEqual([]);
    }
  });

  it("keeps the blueprint's minors clear of the range reserved for filings", () => {
    // Filings are appended over time and blueprint tasks are fixed, so the two
    // can only stay apart if the blueprint never grows into the filing range.
    // Blueprint tasks are identified by seq: the blueprint is the first 288
    // tasks (its own accounting, ballista-technical-blueprint.md §7) and seq is
    // 0-based, so blueprint tasks are seq 0..287 and filings start at 288 --
    // the same boundary the 28th run's roadmap edit had to disambiguate on.
    const FIRST_FILING_SEQ = 288;
    const encroaching = tasks
      .filter((t) => t.seq < FIRST_FILING_SEQ)
      .filter((t) => {
        const match = ID_SHAPE.exec(t.id);
        return match !== null && Number(match[2]) >= FILING_MINOR_FLOOR;
      })
      .map((t) => `${t.id} (seq ${t.seq})`);

    // If this ever fails, the reservation has to move before the next filing is
    // made -- which is the right moment to find out, rather than after a
    // collision has already been committed.
    expect(
      encroaching,
      `blueprint tasks must keep minors below ${FILING_MINOR_FLOOR}, which is reserved for filings`,
    ).toEqual([]);

    // And the converse: every filing sits in phase 0, where filings belong.
    const misfiled = tasks
      .filter((t) => t.seq >= FIRST_FILING_SEQ)
      .filter((t) => t.phase !== 0)
      .map((t) => `${t.id} (seq ${t.seq}, phase ${t.phase})`);
    expect(misfiled).toEqual([]);
  });

  it("documents the id convention in the roadmap itself", () => {
    // A test that encodes a rule nobody wrote down is a trap for the next
    // session: it fails, and the fix is not discoverable from the failure.
    // policy.taskIds is where the rule lives; this keeps the two together.
    expect(
      roadmap.policy?.taskIds,
      "ROADMAP.json policy.taskIds must state the id rules",
    ).toBeDefined();
    expect(roadmap.policy?.taskIds?.length ?? 0).toBeGreaterThan(0);
  });
});
