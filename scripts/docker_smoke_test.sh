#!/usr/bin/env bash
# Smoke test for a built image (CI docker job; also runs locally).
#
#   scripts/docker_smoke_test.sh [IMAGE]     (default mrtklib-docker-ui:ci)
#
# 1. `mrtk --version` reports the pinned MRTKLIB version (.mrtklib-version).
# 2. `mrtk post` on MRTKLIB's RTKLIB sample data, fetched at the pinned tag
#    (07590920.05o / .05n: 1 h at 30 s), writes every epoch. mrtk exits 0
#    even when it writes no solution, so the epochs are counted.
# 3. The server starts and answers /api/health and the page.
set -euo pipefail

IMAGE="${1:-mrtklib-docker-ui:ci}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$(tr -d '[:space:]' < "$ROOT/.mrtklib-version")"
SAMPLE_URL="https://raw.githubusercontent.com/h-shiono/MRTKLIB/$TAG/tests/data/rtklib/rinex"
EXPECTED_EPOCHS=120
PORT="${SMOKE_PORT:-18080}"

WORK="$(mktemp -d)"
NAME="mrtk-smoke-$$"
cleanup() {
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/data" "$WORK/workspace"

# Run as the caller, so the files in the bind-mounted workspace stay removable.
run() {
    docker run --rm -e PUID="$(id -u)" -e PGID="$(id -g)" \
        -v "$WORK/data:/data:ro" -v "$WORK/workspace:/workspace" "$IMAGE" "$@"
}

echo "== mrtk --version (want ${TAG#v})"
# mrtk prints its version on stderr.
version="$(run mrtk --version 2>&1)"
echo "$version"
case "$version" in
    *"ver.${TAG#v}"*) ;;
    *) echo "FAIL: mrtk is not MRTKLIB ${TAG#v}" >&2; exit 1 ;;
esac

echo "== mrtk post on the RTKLIB sample ($TAG)"
for f in 07590920.05o 07590920.05n; do
    curl -fsSL --retry 3 -o "$WORK/data/$f" "$SAMPLE_URL/$f"
done
run mrtk post -p 0 -t -o /workspace/smoke.pos /data/07590920.05o /data/07590920.05n 2>/dev/null
epochs="$(grep -vc '^%' "$WORK/workspace/smoke.pos" || true)"
echo "epochs: $epochs"
if [ "$epochs" != "$EXPECTED_EPOCHS" ]; then
    echo "FAIL: expected $EXPECTED_EPOCHS epochs" >&2
    head -20 "$WORK/workspace/smoke.pos" >&2 || true
    exit 1
fi

echo "== server"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8000" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >"$WORK/health.json" 2>/dev/null; then
        break
    fi
    sleep 1
done
if ! [ -s "$WORK/health.json" ]; then
    echo "FAIL: /api/health did not answer within 60 s" >&2
    docker logs "$NAME" >&2 || true
    exit 1
fi
echo "health: $(cat "$WORK/health.json")"
if ! curl -fsS "http://127.0.0.1:$PORT/" | grep -q '<div id="root">'; then
    echo "FAIL: / does not serve the page" >&2
    exit 1
fi

echo "OK"
