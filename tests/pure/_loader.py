"""Import the integration's pure modules without running its __init__.py.

The pure modules (guest_codes, guest_ratelimit, guest_policy, guest_model, const)
have no Home Assistant imports, so these tests run anywhere, also on Windows
where Home Assistant itself does not.
"""

from __future__ import annotations

import importlib
from pathlib import Path
import sys
import types

PKG_DIR = (
    Path(__file__).resolve().parents[2] / "custom_components" / "guest_ha_dashboard"
)
ALIAS = "dash_guest_pure"

if ALIAS not in sys.modules:
    _pkg = types.ModuleType(ALIAS)
    _pkg.__path__ = [str(PKG_DIR)]
    sys.modules[ALIAS] = _pkg


def load(name: str):
    """Import custom_components/guest_ha_dashboard/<name>.py."""
    return importlib.import_module(f"{ALIAS}.{name}")
