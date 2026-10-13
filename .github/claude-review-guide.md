# Claude PR review guide — mrtklib-docker-ui

This file is read by the `Claude Review` workflow before every review.
It complements `CLAUDE.md` (project constitution): `CLAUDE.md` says how
code in this repo is written; this file says what a reviewer must check,
how deep to go, and how findings are reported.

`tasks/lessons.md` and `tasks/todo.md` are git-ignored and are NOT
available in CI. The review-relevant lessons are folded in below; add
new durable review rules here, not there.

The working directory is the PR's base branch. The code under review is
the PR head, at the path given in the prompt. Read changed files and
their callers from the PR head, not from the base.

## Threat model (read first)

The app runs as a single-user tool in a Docker container, normally on a
trusted LAN, but port 8080 is published on all interfaces by default and
anyone who can reach it can drive the backend. Treat every HTTP / WebSocket
input as untrusted. The backend spawns `mrtk` subprocesses and reads and
writes files, so the highest-impact bugs are path escapes, argument
injection, credential leaks and runaway processes.

## How to review

A review that only reads the diff misses most real bugs in this repo.
Every past fix listed under P1 came from code that looked fine in its
own hunk. Work in this order:

1. **Understand the intent.** Read the PR description and the linked
   issue. Write down in one sentence what the PR claims to change. Any
   change outside that claim is worth a second look (constraint 2 in
   `CLAUDE.md`).
2. **Read every changed file in full** in the PR head, not only the
   hunks. For each changed function, also read its callers and the
   functions it calls. Grep for other users of anything renamed,
   removed, or whose signature or return shape changed.
3. **Find the counterpart.** Most features in this repo have two halves
   that must agree. If one half changed, open the other:
   - backend API ↔ frontend caller (request fields, response shape,
     error format);
   - TOML export (`configToBackend.ts`, `conf2toml.py`) ↔ TOML import
     (`tomlImport.ts`);
   - command preview in the UI ↔ the argument list the backend actually
     builds (`streamArgs.ts`, `ConversionPanel.tsx`, `api/*`);
   - backend masking (`mask_credentials.py`) ↔ frontend masking
     (`utils/maskPath.ts`, `MaskedPathInput`);
   - any rule the frontend re-implements ↔ the backend rule it mirrors.
     A frontend check that decides whether to show, enable or send
     something (path prefix, allowed root, file extension, "is
     configured") must accept exactly what the backend accepts. For
     paths, compare with `paths.resolve_path()`: relative paths resolve
     under `/workspace`, so a UI check like
     `path.startsWith('/workspace/')` wrongly rejects `output.pos`;
   - code ↔ docs (`README.md`, `CLAUDE.md`, `.env.example`,
     `docker-compose.yml`) when the PR changes behaviour they describe.
4. **Attack each change.** For every changed function, try the inputs
   and sequences in the P1 list below (empty, huge, repeated,
   concurrent, reconnect, error path, boundary time) and decide whether
   it survives. A test that exists is not proof: check that it asserts
   the case you are worried about.
5. **Read the tests the PR adds or changes.** Check they would fail
   without the fix. Name the concrete missing case if a P0/P1 path is
   untested.
6. **Consult the advisor** (next section), then post.

## Advisor consultation (mandatory, every review)

Consult the advisor once before posting, **even when you have no
findings**. "Nothing found" is the result most worth a second opinion.
Send:

- the PR's intent in one sentence;
- the changed files, and which files you read in full (changed files,
  callers, counterparts, tests);
- each candidate finding with its evidence (file, line, the input or
  sequence that triggers it), or "no candidates";
- the riskiest areas you checked and cleared, and why you cleared them.

Then:

- Drop findings the advisor rejects with a concrete reason. Keep the
  ones it confirms.
- If the advisor points to an area you did not read, or a case you did
  not try, read it and decide. You may consult once more with the
  result. Do not loop beyond that.
- If you and the advisor still disagree on a finding, keep it and mark
  it `needs maintainer judgement` in the summary, with both views in
  one line each.

## What to check, in priority order

### P0 — security and data safety (always report)

1. **Path handling.** Every file path from a request goes through
   `paths.resolve_path()` *and then* `paths.is_allowed_path()` (and
   `has_hidden_component()` for file-browser style reads) before use.
   `resolve_path()` alone does not reject `..`; a new endpoint that
   skips the second check is a P0. Writes must stay inside `/workspace`
   (`is_within(p, WORKSPACE_ROOT)`); `/data` and
   `/opt/mrtklib/corrections` are read-only. Check symlink handling
   (resolve before the check, not after). IDs used to build paths
   (preset IDs, station IDs, file names from a remote listing) must be
   restricted to a plain name.
2. **Subprocess calls.** Only `asyncio.create_subprocess_exec` with an
   argument list. No `shell=True`, no `create_subprocess_shell`, no
   string-joined commands. User-supplied values that start with `-` must
   not be able to inject `mrtk` flags (stream paths, file names).
3. **Credentials.** NTRIP `user:pass@`, Earthdata/GSI credentials and the
   Anthropic API key must never appear in: log lines sent over WebSocket
   (must pass `mask_credentials.mask_log_line`), API responses (settings
   endpoints return `configured`, never the key), exceptions surfaced to
   the UI, or TOML previews. Masking has failed before on: e-mail user
   names (`a@b.c:pw@host`), passwords containing `/` or `@`, and
   `Basic` / `Bearer` values outside an auth header. Masking must not
   corrupt non-secrets such as serial paths (`/dev/ttyUSB0:115200`).
   New secret-bearing fields or shapes need a case in
   `tests/test_mask_credentials.py`.
4. **Secret files.** `.credentials.toml`, `.ai_settings.toml`, `.netrc`
   must stay unreadable through the file API (dotfile rule). Secrets
   written to TOML must be escaped (`tomli_w`, never string formatting).
5. **Supply chain and build.** Downloads in the Dockerfile or CI are
   pinned (version and checksum, or commit SHA for actions). The image
   builds the MRTKLIB version in `.mrtklib-version`, not a branch.

### P1 — correctness

Report any change that makes the app produce a wrong result, lose or
corrupt data, hang, leak a resource, or crash on a reachable input.
The categories below are where this repo has actually broken before;
they are where to look first, not the only things that count.

6. **Process lifecycle.** Every spawned `mrtk` process is tracked, killed
   on cancel / WebSocket close / app shutdown, and reaped (no zombies).
   Re-attach paths (`mrtk_run` / relay reattach) keep a single owner per
   process. Watch for tasks that are created but never awaited or
   cancelled.
7. **Subprocess output.** Output is always drained, even when no client
   is listening, or the pipe fills and `mrtk` blocks. Lines are read
   through `services/stream_lines.iter_lines` (splits on `\r` as well as
   `\n`; tolerates lines over the 64 KiB `StreamReader` limit). Note that
   `mrtk post` can exit 0 without producing a solution. Do not treat
   exit code 0 as success where the output matters.
8. **Races and stale state.** Check what happens when two requests or
   two runs overlap, when a response arrives after the user started
   something newer, and when a WebSocket reconnects:
   - a stale poll or status response must not overwrite newer state;
   - starts that can be rejected must be serialized, and a rejected
     start must not tear down the running one;
   - `onclose` / `onmessage` from a socket that is no longer
     `wsRef.current` must be ignored;
   - iterating a set of WebSocket clients while sending must use a copy.
9. **Unbounded growth.** Anything kept per job, per run, per line or per
   client (job lists, log buffers, history, caches, React state arrays)
   needs a cap or pruning. File reads for previews must be bounded in
   size and run off the event loop.
10. **`mrtk` CLI contract.** Subcommands and flags must exist in the
    MRTKLIB version pinned in `.mrtklib-version`. A PR that bumps that
    file must update any flag or TOML key that changed upstream (check
    the MRTKLIB CHANGELOG for that range) and the "MRTKLIB version" line
    in `CLAUDE.md`. `mrtk` expands `*` in input paths itself (`*` only,
    file name only, case-insensitive, dotfiles skipped). The backend
    checks and stages patterns with `input_staging.expand_wildcard`,
    which must keep mirroring those rules; it must not hand `mrtk` a
    pattern that matched nothing or a compressed match that was not
    staged.
11. **TOML round-trip.** Import → edit → export must preserve keys that
    have no form field (`rawConfig` merge). A key the UI writes must also
    be read on import, and the reverse. Renamed upstream keys must be
    handled in `conf2toml.py` / `tomlImport.ts`, including deprecation
    aliases. Changes to TOML generation need a case in
    `tests/test_toml_generation.py`.
12. **Preview vs reality.** Any command preview, TOML preview or "this
    will run" text shown in the UI must match what the backend executes.
    A flag added to one side only is a P1.
13. **GNSS time and units.** In `utils/gnssTime.ts`,
    `viewer/posParser.ts`, `viewer/enuUtils.ts` and NMEA handling: GPS
    week / time-of-week rollover, GPST vs UTC leap seconds, day-of-year
    and midnight boundaries, degrees vs radians, ECEF vs geodetic,
    metres vs millimetres. Keep times in the file's own time system and
    label it. Mantine date pickers return local time; UTC values must be
    rebuilt from the fields (`Date.UTC(...)`), or JST users get a 9-hour
    offset. Off-by-one at week or day boundaries is a P1 even if tests
    pass.
14. **WebSocket streaming.** New streaming features copy the existing
    post/run WebSocket pattern (see `CLAUDE.md` constraint 3): connect,
    stream, close cleanly, handle client disconnect without leaking the
    subprocess or the reader task. Long-running runs (`mrtk run`, relay)
    must survive a page reload: the socket opens on mount, the backend
    replays history on connect, and the end of a run is broadcast to
    every client.
15. **Async correctness.** No blocking I/O (file reads, `requests`,
    `ftplib`, `subprocess.run`, `time.sleep`) inside `async def` handlers
    without `run_in_executor` / `asyncio.to_thread`. Network calls have a
    timeout.
16. **Error paths.** An expected failure (bad path, missing file, process
    already running, upstream HTTP error) returns a clear error status
    and message, not an HTTP 500 or a silent success. Downloads write to
    `<file>.part` and rename on success; an HTML login or error page
    saved as data is a P1. httpx drops `Authorization` on cross-host
    redirects.
17. **File targets.** Two streams, runs or jobs must not write to the
    same file. RT / relay file streams (raw logs, solutions) pick a
    fresh numbered name instead of overwriting an existing file, and
    refuse to start when no free name is left.
18. **React state and refs.** Persisted values from Mantine
    `useLocalStorage` arrive after the first render, so do not read them
    once in a `useState` initializer. Assign "latest value" refs in
    `useLayoutEffect`, not during render. In uPlot hooks, tell user
    actions from programmatic ones by comparing ranges, not with a flag
    (hooks fire in a later microtask).
19. **General logic.** Inverted conditions, wrong variable, off-by-one,
    unhandled `None` / `undefined` / empty list, wrong units in a
    comparison, swallowed exceptions that hide a failure the user needs
    to see.

### P2 — conventions and consistency (summary list only)

Report only when clearly violated in lines the PR touches.

20. Mantine v8 only: no `sx` prop, no v6 APIs (e.g. `Select creatable`;
    use `Autocomplete`).
21. `minWidth: 0` on flex children that hold text, tables or charts;
    `minHeight: 0` on `flex: 1` children in a column.
22. IBM Plex Mono for coordinates, console output, TOML/RINEX previews
    and command previews.
23. Quality and constellation colours come from the shared constants in
    `CLAUDE.md`, not new hex literals.
24. Form panels use label-left / input-right (130 px label); section
    headers use `SectionHeader` with an anchor.
25. Form field logic and validation are not changed by a PR whose stated
    purpose is layout or navigation (constraint 2).
26. Docs, comments, labels and help text the PR adds or edits match the
    code (navigation, option names, file paths, versions). A doc that
    tells users to do something the code does not support is P1, not
    P2.
27. Dependency changes come with an updated `uv.lock` / `package-lock.json`.

## What NOT to comment on

- Anything ruff, ESLint or `tsc` already enforce (CI runs them on changed
  files). Do not restate lint findings.
- Formatting, naming taste, import order, comment wording.
- Pre-existing problems in lines the PR does not touch, unless the PR
  makes them reachable in a new way.
- Speculative "consider adding tests" without naming the concrete case
  that is missing.
- Hypothetical problems you could not tie to a concrete input or
  sequence after reading the code.
- Praise.

## How to report

- **Verify before posting.** Every finding names the file and line, the
  concrete input or sequence that triggers it, and what goes wrong. Drop
  anything you cannot tie to a trigger after reading the code.
- **Only claim checks you actually ran.** `Checked:` lists what you
  read or computed yourself in this run (a file you opened, a hash you
  computed with `sha256sum`, a search you ran). Something you took from
  the PR description, a commit message, another review or a passing CI
  job is not a check; put it under "Not verified" with its source.
- **Form your own findings.** Do not read other reviewers' comments
  (`gh pr view --comments`, review threads) before you have consulted
  the advisor; they bias the review and hide what you would have missed.
- **Inline comments** only for P0 and P1, on the exact changed line, at
  most 8 per review. Each comment: one sentence on what goes wrong, one
  on the trigger, and a suggested fix (a `suggestion` block when the fix
  is a few lines).
- **One summary comment** on the PR (via `gh pr comment`):
  - first line: `Verdict: ready to merge` / `Verdict: changes requested`
    / `Verdict: needs maintainer judgement`
  - a 2–4 line description of what the PR does
  - counts of P0 / P1 / P2 findings, and P2 items as a short list
    (no inline comments for P2)
  - `Checked:` the files you read beyond the diff (callers,
    counterparts, tests), in one line
  - `Advisor:` one line on what the advisor confirmed, rejected or sent
    you to check
  - `Not verified:` anything you could not check yourself (e.g. needs a
    real receiver, the Docker image, or a tool you do not have), stated
    plainly
- Write in English, plainly. No emoji, no headings beyond what the
  summary needs.
