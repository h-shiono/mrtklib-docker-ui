# Review rules — mrtklib-docker-ui

Context a reviewer cannot get from the code alone. Conventions are in
`CLAUDE.md`. Add a rule here only when it encodes deployment context,
upstream or library behaviour, or a severity decision.

## Deployment and threat model

- Single-user tool with **no authentication**. Port 8080 is published on
  all interfaces by default, so anyone who can reach it can drive the
  backend. Treat every HTTP / WebSocket input as untrusted.
- The backend spawns `mrtk` and reads and writes files, so path escapes,
  argument injection, credential leaks and runaway processes are the
  highest-impact bugs.
- `/workspace` is the only writable root. `/data` and
  `/opt/mrtklib/corrections` are read-only mounts. `paths.resolve_path()`
  maps relative paths under `/workspace` and does not reject `..` by
  itself; `paths.is_allowed_path()` must follow it.
- Secrets (NTRIP `user:pass@`, Earthdata/GSI, the Anthropic key) live in
  dotfiles under `/workspace` and in stream paths. Masking has failed
  before on e-mail user names, passwords containing `/` or `@`, and
  bare `Basic` / `Bearer` values.

## MRTKLIB (`mrtk`) behaviour

- `mrtk` expands `*` in input paths itself (file name only,
  case-insensitive, `*` only, dotfiles skipped). The backend mirrors this
  in `input_staging.expand_wildcard`; it does not use `glob`.
- `mrtk post` can exit 0 without producing a solution (e.g. failed
  decompression). Exit code 0 is not proof of success.
- `mrtk run` (rtkrcv) ignores `files.trace` and writes
  `rtkrcv_*.trace`, `*.stat` and `rtkrcv.nav` into its working
  directory, so it must start with an explicit `cwd`.
- The rtkrcv `stream` command's state column is set once at open. It
  reads "connected" while an NTRIP client retries forever, so it is not
  a live connection state.
- `mrtk` output can contain `\r`-only progress lines and lines longer
  than asyncio's 64 KiB `StreamReader` limit. Output must be drained even
  when no client is listening, or the pipe fills and `mrtk` blocks.
- Subcommands and flags must exist in the version pinned in
  `.mrtklib-version`.

## External services and libraries

- CDDIS redirects to `urs.earthdata.nasa.gov`. httpx drops
  `Authorization` on that cross-host hop, and URS then returns its HTML
  login page with status 200. Downloads must reject HTML where data is
  expected, and write to `<file>.part` before renaming.
- RNXCMP 4.2.0 is C99 (`gcc -ansi` fails) and `crx2rnx -h` exits 1.
- Mantine date pickers return local time. UTC values must be rebuilt
  from the fields, or JST users get a 9-hour offset.
- Mantine `useLocalStorage` hydrates after the first render, so a
  `useState` initializer only sees the default.
- uPlot fires `setScale` hooks in a later microtask, so a
  "programmatic change" flag set around the call is already cleared.

## Severity and scope

- **High:** path escape, write outside `/workspace`, `mrtk` flag or
  argument injection, an unmasked secret, a leaked or orphaned process.
- **Medium:** wrong results, lost or corrupted data, hangs, unbounded
  growth, a UI preview that differs from what actually runs, a frontend
  check that disagrees with the backend rule it mirrors, docs that tell
  users to do something the code does not support.
- **Low:** convention issues from `CLAUDE.md` in lines the PR touches.
- Do not comment on what ruff, ESLint or `tsc` enforce (CI runs them),
  style taste, or problems in lines the PR does not touch.
