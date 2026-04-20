---
name: Bug report
about: Report a UI bug, API error, Docker issue, or unexpected behavior of the web UI
title: "[Bug] <short summary>"
labels: ["bug", "status:needs-triage"]
assignees: []
---

<!--
Thanks for reporting a bug. Please fill in each section so we can reproduce
and triage quickly.

For positioning-accuracy issues, Fix-rate regressions, or crashes in the
`mrtk` binary itself, please file an issue on MRTKLIB instead:
https://github.com/h-shiono/MRTKLIB/issues
-->

## Summary

<!-- One or two sentences: what went wrong? -->

## Where does it fail?

<!-- Check all that apply. This helps us route the issue. -->

- [ ] Frontend (UI rendering, form, chart, navigation)
- [ ] Backend API (FastAPI endpoint, WebSocket)
- [ ] `mrtk` process invocation (spawned by backend)
- [ ] Docker image build / container startup
- [ ] Preset / TOML import-export round-trip
- [ ] Other / unsure

## Environment

- UI version: <!-- e.g. v0.1.0-alpha (see header of the UI) -->
- MRTKLIB pinned version: <!-- see `.mrtklib-version` or the UI header -->
- Deployment: <!-- Docker Hub image / GHCR image / self-built / dev mode (vite + uvicorn) -->
- Docker version (if applicable): <!-- `docker --version` -->
- Host OS: <!-- e.g. macOS 14.5 (arm64), Ubuntu 22.04, Windows 11 + WSL2 -->
- Browser + version: <!-- e.g. Chrome 131, Safari 17.4, Firefox 128 -->
- Affected tab(s): <!-- Post Processing / Real-Time / Stream Server / Conversion / Tools / Monitor -->

## Steps to reproduce

1.
2.
3.

<!--
Include the exact action sequence (tab → sidebar item → form fields →
button). If a TOML preset or input file is involved, attach it (redact
credentials in NTRIP URLs etc.). If the data cannot be shared, describe
it (receiver, duration, constellations).
-->

## Expected behavior

<!-- What should have happened? -->

## Actual behavior

<!-- What actually happened? Include the error message verbatim. -->

## Logs / output

<!--
Useful places to look:
- Browser DevTools console (F12 → Console)
- Browser DevTools network tab (failing request + response body)
- Container logs: `docker compose logs -f` or `docker logs <container>`
- UI's built-in log panel (Post / Real-Time / Stream / Convert tabs)
Keep excerpts short; attach full logs as files if large.
-->

<details>
<summary>Relevant log excerpt</summary>

```
# paste log output here
```

</details>

## Additional context

<!-- Screenshots, related issues, recent changes, etc. -->
