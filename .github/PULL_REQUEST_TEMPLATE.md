<!--
Thanks for contributing to mrtklib-docker-ui. Please fill in the
sections below. Delete any section that does not apply.
-->

## Summary

<!-- What does this PR change, and why? One short paragraph. -->

## Related issues

<!-- e.g. Closes #123, Refs #456 -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Refactor (no functional change)
- [ ] Documentation only
- [ ] Docker / build / CI / tooling
- [ ] MRTKLIB version bump (`.mrtklib-version`)
- [ ] Breaking change (describe migration below)

## Verification

How did you verify this change? Check all that apply and paste relevant
output.

- [ ] `cd frontend && npm run lint`
- [ ] `cd frontend && npm run build`
- [ ] `uv sync && uv run uvicorn mrtklib_web_ui.main:app --reload --host 0.0.0.0 --port 8000`
- [ ] `docker compose up --build` reaches http://localhost:8080
- [ ] Manually exercised the affected tab(s) in a browser
- [ ] TOML import → export round-trip preserved (if config I/O touched)

<details>
<summary>Manual test notes</summary>

<!--
Describe what you clicked / what you observed. For UI changes, a short
screen recording or before/after screenshots is very helpful.
-->

</details>

## Affected area

<!--
- Tab: Post Processing / Real-Time / Stream Server / Conversion / Tools / Monitor
- Layer: frontend / backend / docker / ci / docs
-->

## Breaking changes / migration notes

<!--
Preset schema changes, TOML key renames, API route changes, env var
changes, Docker volume/port changes, etc.
-->

## Checklist

- [ ] I have read the project conventions in `CLAUDE.md`
- [ ] Mantine v8 patterns only (no `sx` prop, no v6 patterns)
- [ ] `minWidth: 0` added where flex children need it
- [ ] No unrelated changes included in this PR
