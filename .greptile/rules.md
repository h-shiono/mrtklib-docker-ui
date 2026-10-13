# Review rules — mrtklib-docker-ui

Follow `.github/review-guide.md` for the full checklist. The rules that
matter most:

- Treat every HTTP / WebSocket input as untrusted: port 8080 is
  published on all interfaces and there is no authentication.
- File paths from requests go through `paths.resolve_path()` and then
  `paths.is_allowed_path()`. Writes stay inside `/workspace`; `/data`
  and `/opt/mrtklib/corrections` are read-only.
- Subprocesses use `asyncio.create_subprocess_exec` with an argument
  list. Values starting with `-` must not inject `mrtk` flags.
- Credentials never reach WebSocket logs, API responses, errors or
  previews unmasked (`mask_credentials.mask_log_line`).
- Check both halves of a change: backend API and frontend caller, TOML
  export and import, command preview and the real argument list, and
  any frontend check that re-implements a backend rule.
- Look for races (stale responses, overlapping runs or downloads,
  reconnects), unbounded growth, blocking I/O in `async def`, and
  GPS/UTC/local time mistakes.
- Do not restate lint findings (ruff, ESLint, tsc run in CI), style
  preferences, or problems in lines the PR does not touch.
