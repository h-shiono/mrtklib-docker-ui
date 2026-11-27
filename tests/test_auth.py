"""Optional access token on the REST and WebSocket routes (#86)."""

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocketDisconnect

from mrtklib_web_ui import auth
from mrtklib_web_ui.main import app

TOKEN = "correct-horse-battery-staple"


@pytest.fixture
def client(monkeypatch):
    """The real app with a token set. No lifespan: nothing is started."""
    monkeypatch.setenv(auth.ENV_TOKEN, TOKEN)
    return TestClient(app)


@pytest.fixture
def open_client(monkeypatch):
    monkeypatch.delenv(auth.ENV_TOKEN, raising=False)
    return TestClient(app)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── Off by default ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "", "   "])
def test_unset_or_blank_token_means_off(monkeypatch, value):
    # compose passes MRTK_AUTH_TOKEN=${MRTK_AUTH_TOKEN:-}, i.e. "" when unset
    if value is None:
        monkeypatch.delenv(auth.ENV_TOKEN, raising=False)
    else:
        monkeypatch.setenv(auth.ENV_TOKEN, value)
    assert auth.configured_token() is None
    client = TestClient(app)
    assert client.get("/api/files/roots").status_code == 200
    assert client.get("/api/auth/status").json() == {"required": False, "authenticated": True}
    with client.websocket_connect("/ws/logs"):
        pass


def test_login_without_a_token_configured_sets_nothing(open_client):
    res = open_client.post("/api/auth/login", json={"token": "anything"})
    assert res.json() == {"required": False, "authenticated": True}
    assert auth.COOKIE_NAME not in res.cookies


# ── With a token ─────────────────────────────────────────────────────────────

def test_api_is_refused_without_credentials(client):
    res = client.get("/api/files/roots")
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"
    assert client.post("/api/mrtk-run/stop").status_code == 401
    assert client.get("/openapi.json").status_code == 401
    assert client.get("/docs").status_code == 401


def test_health_and_status_stay_open(client):
    # The image and compose healthchecks call /api/health with no credentials
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/auth/status").json() == {"required": True, "authenticated": False}


def test_bearer_token(client):
    assert client.get("/api/files/roots", headers=_bearer(TOKEN)).status_code == 200
    assert client.get("/api/files/roots", headers={"Authorization": f"bearer {TOKEN}"}).status_code == 200


@pytest.mark.parametrize("header", [
    "Bearer wrong", "Bearer", "Bearer ", f"Basic {TOKEN}", TOKEN, f"Bearer {TOKEN}x", "",
])
def test_wrong_or_empty_bearer_is_refused(client, header):
    assert client.get("/api/files/roots", headers={"Authorization": header}).status_code == 401


def test_login_sets_a_session_cookie(client):
    res = client.post("/api/auth/login", json={"token": TOKEN})
    assert res.status_code == 200
    assert res.json() == {"required": True, "authenticated": True}
    set_cookie = res.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert "path=/" in set_cookie
    # Plain http (http://<LAN-IP>:8080): a Secure cookie would be dropped
    assert "secure" not in set_cookie
    # The cookie is not the token
    assert TOKEN not in res.headers["set-cookie"]
    assert client.cookies[auth.COOKIE_NAME] == auth.session_value(TOKEN)

    # The client now carries the cookie: REST, downloads and WebSockets pass
    assert client.get("/api/files/roots").status_code == 200
    assert client.get("/api/auth/status").json() == {"required": True, "authenticated": True}
    with client.websocket_connect("/ws/logs"):
        pass


def test_login_cookie_is_secure_behind_a_tls_proxy(client):
    res = client.post(
        "/api/auth/login", json={"token": TOKEN}, headers={"X-Forwarded-Proto": "https"}
    )
    assert "secure" in res.headers["set-cookie"].lower()


@pytest.mark.parametrize("token", ["wrong", "", TOKEN + "x", TOKEN[:-1]])
def test_login_with_a_wrong_token(client, token):
    res = client.post("/api/auth/login", json={"token": token})
    assert res.status_code == 401
    assert "set-cookie" not in res.headers
    assert client.get("/api/files/roots").status_code == 401


def test_cookie_of_another_token_is_refused(client, monkeypatch):
    client.post("/api/auth/login", json={"token": TOKEN})
    assert client.get("/api/files/roots").status_code == 200
    # The token changes (container restarted with a new one)
    monkeypatch.setenv(auth.ENV_TOKEN, "another-long-random-token")
    assert client.get("/api/files/roots").status_code == 401
    # ... and the raw token is never accepted as a cookie value
    client.cookies.set(auth.COOKIE_NAME, "another-long-random-token")
    assert client.get("/api/files/roots").status_code == 401


def test_logout_drops_the_cookie(client):
    client.post("/api/auth/login", json={"token": TOKEN})
    res = client.post("/api/auth/logout")
    assert res.json() == {"required": True, "authenticated": False}
    assert auth.COOKIE_NAME not in client.cookies
    assert client.get("/api/files/roots").status_code == 401


def test_cors_preflight_needs_no_credentials(client):
    # Development: the page on :5173 preflights before sending the cookie
    res = client.options(
        "/api/mrtk-run/start",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


# ── Every route ──────────────────────────────────────────────────────────────

# Not under a common prefix (/ws/logs is outside /api), so check each route
# of the real app instead of trusting one.
_OPEN_ROUTES = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/logout"}


def _concrete(path: str) -> str:
    """A request path for a route template: fill each {param} with a value."""
    out = []
    for part in path.split("/"):
        out.append("x" if part.startswith("{") else part)
    return "/".join(out)


def test_every_http_route_needs_credentials(client):
    checked = 0
    for route in app.routes:
        if isinstance(route, WebSocketRoute) or not hasattr(route, "methods"):
            continue
        if route.path in _OPEN_ROUTES:
            continue
        # The static UI (only registered when /app/static exists) is public
        if isinstance(route, APIRoute) and route.name == "serve_spa":
            continue
        for method in route.methods - {"HEAD", "OPTIONS"}:
            res = client.request(method, _concrete(route.path))
            assert res.status_code == 401, f"{method} {route.path} answered {res.status_code}"
            checked += 1
    assert checked > 50  # the app's routes were really walked


def test_every_websocket_route_needs_credentials(client):
    paths = [r.path for r in app.routes if isinstance(r, WebSocketRoute)]
    assert "/ws/logs" in paths and len(paths) >= 7
    for path in paths:
        with pytest.raises(WebSocketDisconnect) as refused:
            with client.websocket_connect(_concrete(path)):
                pass
        assert refused.value.code == 1008, path


def test_websocket_with_bearer_token(client):
    with client.websocket_connect("/api/mrtk-run/ws", headers=_bearer(TOKEN)) as ws:
        assert ws.receive_json()["type"] == "history"


def test_static_ui_paths_are_public():
    assert auth.is_public("http", "/")
    assert auth.is_public("http", "/assets/index-abc.js")
    assert auth.is_public("http", "/favicon.ico")
    assert not auth.is_public("http", "/api/files/roots")
    assert not auth.is_public("http", "/ws/logs")
    assert not auth.is_public("http", "/api")
    # A WebSocket is never public, whatever its path
    assert not auth.is_public("websocket", "/")
    assert not auth.is_public("websocket", "/assets/x")
