"""Mask credentials in log output to prevent leaking passwords."""

import re

# user:pass@ (NTRIP / stream paths, URLs). The password runs to the last '@'
# of the whitespace-free token, so one containing '@' is masked whole.
_USERINFO = re.compile(r"([^:@/\s]+):([^/\s]*)@")
# ?token=... / &api_key=... in URLs
_QUERY_SECRET = re.compile(
    r"([?&](?:password|passwd|pass|pwd|token|access_token|api_key|apikey|key|secret)=)[^&\s]+",
    re.IGNORECASE,
)
# password = "...", api_key: '...' (TOML / config dumps); the key may carry a
# prefix such as `user_password` or `GSI_PASSWORD`.
_ASSIGNED_SECRET = re.compile(
    r"""(\b\w*(?:password|passwd|token|api_key|apikey|secret)\w*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,&]+)""",
    re.IGNORECASE,
)
# "Authorization: Bearer|Basic <value>", or a bare "Bearer <long token>".
# "Basic" alone is an ordinary word ("Basic Strategy"), so it needs the header.
_AUTH_HEADER = re.compile(
    r"(\bAuthorization:\s*(?:Bearer|Basic)\s+|\bBearer\s+(?=[A-Za-z0-9._~+/=-]{16,}))"
    r"[A-Za-z0-9._~+/=-]+",
    re.IGNORECASE,
)


def _mask_assigned(m: re.Match[str]) -> str:
    value = m.group(2)
    quote = value[0] if value[:1] in ("'", '"') else ""
    return f"{m.group(1)}{quote}***{quote}"


def mask_log_line(line: str) -> str:
    """Mask credentials in a log line (user:pass@, secret query params,
    secret-looking assignments and Authorization headers)."""
    line = _USERINFO.sub(lambda m: f"{m.group(1)}:***@", line)
    line = _QUERY_SECRET.sub(lambda m: f"{m.group(1)}***", line)
    line = _ASSIGNED_SECRET.sub(_mask_assigned, line)
    return _AUTH_HEADER.sub(lambda m: f"{m.group(1)}***", line)
