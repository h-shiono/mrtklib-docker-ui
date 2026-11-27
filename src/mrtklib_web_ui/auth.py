"""Optional access token for the API and WebSocket routes (#86).

Off unless ``MRTK_AUTH_TOKEN`` is set. With a token, every route but the
ones in ``is_public`` needs one of:

- the session cookie, set by ``POST /api/auth/login`` (the browser UI), or
- ``Authorization: Bearer <token>`` (scripts).

The cookie reaches the page's ``fetch`` calls, download links and WebSocket
handshakes alike, so no call site carries the token. Its value is derived
from the token, so it holds across restarts and stops working when the
token changes.

There is no attempt limit: the token must be long and random (see
``MIN_TOKEN_LENGTH``), which is what keeps guessing out of reach.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

ENV_TOKEN = "MRTK_AUTH_TOKEN"
COOKIE_NAME = "mrtk_session"
COOKIE_MAX_AGE = 30 * 24 * 3600  # seconds; changing the token ends it sooner
MIN_TOKEN_LENGTH = 16  # shorter tokens work, with a warning at startup

_SESSION_CONTEXT = b"mrtklib-web-ui session v1"

# Routes that answer without credentials: the container healthcheck, and the
# login endpoints themselves.
_PUBLIC_PATHS = frozenset({"/api/health"})
_PUBLIC_PREFIXES = ("/api/auth/",)
# HTTP paths that need credentials. Anything else over HTTP is the static UI
# (index.html and its assets), which holds no data and must load to show the
# login form. WebSockets always need credentials.
_PROTECTED_PREFIXES = ("/api/", "/ws/", "/docs/")  # /docs/oauth2-redirect
_PROTECTED_PATHS = frozenset({"/api", "/ws", "/docs", "/redoc", "/openapi.json"})


def configured_token() -> str | None:
    """The token from the environment; empty or blank means auth is off."""
    token = os.environ.get(ENV_TOKEN, "").strip()
    return token or None


def session_value(token: str) -> str:
    """The cookie value for a token: a keyed digest, never the token itself."""
    return hmac.new(token.encode(), _SESSION_CONTEXT, hashlib.sha256).hexdigest()


def token_matches(presented: str, token: str) -> bool:
    """Compare in constant time, on digests so the lengths are equal."""
    return hmac.compare_digest(session_value(presented), session_value(token))


def is_public(scope_type: str, path: str) -> bool:
    """True if the route answers without credentials while auth is on."""
    if path in _PUBLIC_PATHS or path.startswith(_PUBLIC_PREFIXES):
        return True
    if scope_type != "http":
        return False
    return path not in _PROTECTED_PATHS and not path.startswith(_PROTECTED_PREFIXES)


def is_authenticated(conn: HTTPConnection, token: str) -> bool:
    """True if the request carries the session cookie or the bearer token."""
    cookie = conn.cookies.get(COOKIE_NAME)
    if cookie and hmac.compare_digest(cookie.encode(), session_value(token).encode()):
        return True
    scheme, _, value = conn.headers.get("authorization", "").partition(" ")
    value = value.strip()
    return scheme.lower() == "bearer" and bool(value) and token_matches(value, token)


def log_startup_state() -> None:
    """Say at startup whether the API is protected."""
    # uvicorn's own logger: it prints INFO, which the app's loggers do not
    logger = logging.getLogger("uvicorn.error")
    token = configured_token()
    if token is None:
        logger.warning(
            "Access token: off (%s is not set). Anyone who can reach this port "
            "can use the API; keep it on localhost or behind an authenticating proxy.",
            ENV_TOKEN,
        )
    elif len(token) < MIN_TOKEN_LENGTH:
        logger.warning(
            "Access token: on, but %s is shorter than %d characters and can be "
            "guessed. Use a long random value, e.g. `openssl rand -hex 32`.",
            ENV_TOKEN, MIN_TOKEN_LENGTH,
        )
    else:
        logger.info("Access token: on (%s is set)", ENV_TOKEN)


class AuthMiddleware:
    """Refuse HTTP and WebSocket requests without credentials.

    Pure ASGI, because Starlette's ``BaseHTTPMiddleware`` never sees
    WebSocket handshakes.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        token = configured_token()
        if (
            token is None
            or is_public(scope["type"], scope["path"])
            or is_authenticated(HTTPConnection(scope), token)
        ):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            # Closing before accept refuses the handshake (HTTP 403)
            await send({"type": "websocket.close", "code": 1008, "reason": "Authentication required"})
            return
        response = JSONResponse(
            {"detail": "Authentication required"},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
        await response(scope, receive, send)


# ── /api/auth ────────────────────────────────────────────────────────────────

router = APIRouter()


class AuthStatus(BaseModel):
    required: bool  # a token is configured
    authenticated: bool  # this request may use the API


class LoginRequest(BaseModel):
    token: str


def _is_https(request: Request) -> bool:
    """True if the browser reached us over https, directly or through a proxy."""
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return request.url.scheme == "https" or forwarded == "https"


@router.get("/status")
async def auth_status(request: Request) -> AuthStatus:
    token = configured_token()
    if token is None:
        return AuthStatus(required=False, authenticated=True)
    return AuthStatus(required=True, authenticated=is_authenticated(request, token))


@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response) -> AuthStatus:
    """Exchange the token for the session cookie."""
    token = configured_token()
    if token is None:
        return AuthStatus(required=False, authenticated=True)
    if not token_matches(body.token.strip(), token):
        raise HTTPException(status_code=401, detail="Wrong access token")
    response.set_cookie(
        COOKIE_NAME,
        session_value(token),
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="strict",
        # Only over https: a Secure cookie is dropped on plain http://<LAN-IP>
        secure=_is_https(request),
        path="/",
    )
    return AuthStatus(required=True, authenticated=True)


@router.post("/logout")
async def logout(response: Response) -> AuthStatus:
    """Drop this browser's session cookie."""
    response.delete_cookie(COOKIE_NAME, path="/")
    return AuthStatus(required=configured_token() is not None, authenticated=configured_token() is None)
