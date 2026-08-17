"""Runtime locations that can be supplied by a durable deployment."""

from __future__ import annotations

import os
from pathlib import Path

_REPOSITORY_ROOT = Path(__file__).resolve().parent.parent


def state_file() -> Path:
    """Return the operator-selected state location, defaulting to local dev."""
    configured = os.environ.get("WILDWATCH_STATE_FILE")
    if configured:
        return Path(configured).expanduser()
    return _REPOSITORY_ROOT / ".state.json"
