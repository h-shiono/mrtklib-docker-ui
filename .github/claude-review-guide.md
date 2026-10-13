# Claude PR review guide — mrtklib-docker-ui

This file is read by the `Claude Review` workflow before every review.
It complements `CLAUDE.md` (project constitution): `CLAUDE.md` says how
code in this repo is written; this file says what a reviewer must check
and how findings are reported.

`tasks/lessons.md` and `tasks/todo.md` are git-ignored and are NOT
available in CI. Durable review rules belong here instead.

## Threat model (read first)

The app runs as a single-user tool in a Docker container, normally on a
trusted LAN, but port 8080 is published on all interfaces by default and
anyone who can reach it can drive the backend. Treat every HTTP / WebSocket
input as untrusted. The backend spawns `mrtk` subprocesses and reads and
writes files, so the highest-impact bugs are path escapes, argument
injection, credential leaks and runaway processes.

## What to check, in priority order

### P0 — security and data safety (always report)

1. **Path handling.** Every file path from a request goes through
   `paths.resolve_path()` *and then* `paths.is_allowed_path()` (and
   `has_hidden_component()` for file-browser style reads) before use.
   `resolve_path()` alone does not reject `..`; a new endpoint that
   skips the second check is a P0. Writes must stay inside `/workspace`
   (`is_within(p, WORKSPACE_ROOT)`); `/data` and
   `/opt/mrtklib/corrections` are read-only. Check symlink handling
   (resolve before the check, not after).
2. **Subprocess calls.** Only `asyncio.create_subprocess_exec` with an
   argument list. No `shell=True`, no `create_subprocess_shell`, no
   string-joined commands. User-supplied values that start with `-` must
   not be able to inject `mrtk` flags (stream paths, file names).
3. **Credentials.** NTRIP `user:pass@`, Earthdata/GSI credentials and the
   Anthropic API key must never appear in: log lines sent over WebSocket
   (must pass `mask_credentials.mask_log_line`), API responses (settings
   endpoints return `configured`, never the key), exceptions surfaced to
   the UI, or TOML previews. New secret-bearing fields need masking
   coverage and a test in `tests/test_mask_credentials.py`.
4. **Secret files.** `.credentials.toml`, `.ai_settings.toml`, `.netrc`
   must stay unreadable through the file API (dotfile rule).

### P1 — correctness

5. **Process lifecycle.** Every spawned `mrtk` process is tracked, killed
   on cancel / WebSocket close / app shutdown, and reaped (no zombies).
   Re-attach paths (`mrtk_run` / relay reattach) keep a single owner per
   process. Watch for tasks that are created but never awaited/cancelled.
6. **`mrtk` CLI contract.** Subcommands and flags must exist in the
   MRTKLIB version pinned in `.mrtklib-version`. A PR that bumps that
   file must update any flag or TOML key that changed upstream (check
   the MRTKLIB CHANGELOG for that range) and the "MRTKLIB version" line
   in `CLAUDE.md`.
7. **TOML round-trip.** Import → edit → export must preserve keys that
   have no form field (`rawConfig` merge). Renamed upstream keys must be
   handled in `conf2toml.py` / `tomlImport.ts`, including deprecation
   aliases. Changes to TOML generation need a case in
   `tests/test_toml_generation.py`.
8. **GNSS time and units.** In `utils/gnssTime.ts`, `posParser.ts`,
   `enuUtils.ts`: GPS week / time-of-week rollover, GPST vs UTC leap
   seconds, day-of-year boundaries, degrees vs radians, ECEF vs
   geodetic, metres vs millimetres. Off-by-one at week or day boundaries
   is a P1 even if tests pass.
9. **WebSocket streaming.** New streaming features copy the existing
   post/run WebSocket pattern (see `CLAUDE.md` constraint 3): connect,
   stream, close cleanly, handle client disconnect without leaking the
   subprocess or the reader task.
10. **Async correctness.** No blocking I/O (file reads, `requests`,
    `subprocess.run`) inside `async def` handlers without
    `run_in_executor` / `asyncio.to_thread`.

### P2 — project conventions (report only when clearly violated)

11. Mantine v8 only: no `sx` prop, no v6 APIs.
12. `minWidth: 0` on flex children that hold text, tables or charts.
13. IBM Plex Mono for coordinates, console output, TOML/RINEX previews
    and command previews.
14. Quality and constellation colours come from the shared constants in
    `CLAUDE.md`, not new hex literals.
15. Form panels use label-left / input-right (130 px label).
16. Form field logic and validation are not changed by a PR whose stated
    purpose is layout or navigation (constraint 2).

## What NOT to comment on

- Anything ruff, ESLint or `tsc` already enforce (CI runs them on changed
  files). Do not restate lint findings.
- Formatting, naming taste, import order, comment wording.
- Pre-existing problems in lines the PR does not touch, unless the PR
  makes them reachable in a new way.
- Speculative "consider adding tests" without naming the concrete case
  that is missing.
- Praise. A clean PR gets a one-line summary, nothing more.

## How to report

- **Verify before posting.** For each candidate finding, open the
  surrounding code (callers, the helper being used, existing tests) and
  confirm the problem is real in this codebase. Drop anything you cannot
  confirm. Before posting P0/P1 findings, consult the advisor with the
  list of findings and the evidence for each; drop the ones it rejects.
- **Inline comments** only for P0 and P1, on the exact changed line, at
  most 8 per review. Each comment: one sentence on what goes wrong, one
  on the concrete trigger (input or sequence), and a suggested fix (a
  `suggestion` block when the fix is a few lines).
- **One summary comment** on the PR (via `gh pr comment`):
  - first line: `Verdict: ready to merge` / `Verdict: changes requested`
    / `Verdict: needs maintainer judgement`
  - a 2–4 line description of what the PR does
  - counts of P0 / P1 / P2 findings, and P2 items as a short list
    (no inline comments for P2)
  - anything you could not verify (e.g. needs a real receiver or the
    Docker image), stated plainly
- Write in English, plainly. No emoji, no headings beyond what the
  summary needs.
