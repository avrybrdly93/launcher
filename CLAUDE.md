# Repository workflow policy

This repository does not use a pull-request review workflow. When completing
coding tasks here:

- Commit and push changes directly to `main`. Do not open a pull request and
  wait for human approval before landing work.
- Before pushing to `main`, run the project's typecheck/lint/test suite
  locally (see `.github/workflows/ci.yml` for the exact commands: `pnpm
  typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm test`, build) so broken
  code doesn't land un-vetted. CI still runs on every push to `main` as a
  backstop.
- Don't leave long-lived `claude/*` branches around after a task finishes.
  If you must work on a branch (e.g. to get CI signal before merging), merge
  it into `main` and delete it yourself once done rather than leaving it for
  someone else to close out.
