# Ballista Autonomous Build Routine

Setup: in Claude Code (connected to `avrybrdly93/launcher`), create a Routine with a
scheduled trigger (e.g. every 4–6 hours to start) and paste the prompt below as the
task definition. Commit `ROADMAP.json` and this file to the repo root first — the
routine reads its state from `ROADMAP.json`, so the repo itself is the scheduler's
memory between runs.

---

## Routine prompt

You are working through the Ballista roadmap in this repository. Follow this procedure
exactly on every run:

1. **Sync.** `git pull` on `main`. Read `ROADMAP.json` at the repo root. Read
   `ballista-technical-blueprint.md` for the design context of whatever task you pick
   (each task ID maps to a row in §7 and usually a design section elsewhere in the doc).

2. **Select a task** per `ROADMAP.json → policy.taskSelection`:
   first `in-progress`, else first `review`, else first `todo`, in `seq` order.
   - `review` tasks: the code already exists — audit it against the task's
     `validation` criterion, add any missing tests, fix gaps, then mark `done`.

3. **Implement.** Respect the blueprint's invariants: layered imports (L0–L5, lower
   layers never import upper), zero allocations on solver hot paths, determinism
   (fixed force ordering, seeded RNG), and the task's stated validation criterion.

4. **Validate.** Run `pnpm -r test` and lint. A task is only `done` when its
   validation criterion demonstrably passes (a green test encoding it, or a measured
   number meeting the stated bound). Write that test if it doesn't exist yet.

5. **Commit — this is the non-negotiable part.**
   - Commit after every medium-sized coherent change, not just at the end.
   - Commit message format: `<TASK-ID>: <summary>` (e.g. `P1.16: implement buoyancy force`).
   - Update the task's `status` (and `notes` if partial) in `ROADMAP.json`
     **in the same commit** as the code it describes.
   - Never end a run with uncommitted work. If you sense you are approaching a usage
     or time limit, stop implementing immediately, get the working tree to a green
     (or clearly-noted partial) state, set the task to `in-progress` with remaining
     work described in `notes`, commit, and push. A committed partial state is
     always preferable to lost work.
   - Never commit a red build to `main`; if tests are broken mid-task, either fix
     them or stash the breakage behind a note and commit only the green subset.

6. **Continue or stop.** If ample capacity remains after a task, select the next one
   and repeat from step 2. Otherwise push and stop. Do at most one `H`-difficulty
   task per run.

Hard rules: never force-push, never rewrite history, never edit files under
`docs/adr/` except to add new ADRs, never modify golden/reference data without a
commit message explaining why results moved.
