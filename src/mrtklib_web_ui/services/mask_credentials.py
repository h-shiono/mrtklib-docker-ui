"""Mask credentials in log output to prevent leaking passwords."""

import re

_CRED_PATTERN = re.compile(r'([^:@/\s]+):([^@\s]+)@')


def mask_log_line(line: str) -> str:
    """Mask user:pass@ patterns in log output."""
    return _CRED_PATTERN.sub(lambda m: f'{m.group(1)}:***@', line)
