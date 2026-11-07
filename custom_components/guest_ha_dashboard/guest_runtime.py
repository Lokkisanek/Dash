"""Shared runtime of guest passes: storage, rate limiter, live guest sockets."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import CLOSE_PROFILE_CHANGED, CLOSE_REVOKED, DOMAIN
from .guest_ratelimit import FailureLimiter
from .guest_store import GuestStore

if TYPE_CHECKING:
    from .store import GuestDashboardStore


class GuestSocket(Protocol):
    """What the runtime needs from a live guest websocket session."""

    pass_id: str

    def close_soon(self, code: int, reason: str) -> None:
        """Close the socket from the event loop."""

    def reschedule_expiry(self) -> None:
        """Re-read valid_until and move the expiry timer."""

    def push_config(self) -> None:
        """Send the (filtered) dashboard config again."""


class GuestRuntime:
    """Lives in hass.data[DOMAIN]['guests'] while the integration is loaded."""

    def __init__(
        self, hass: HomeAssistant, store: GuestStore, config_store: GuestDashboardStore
    ) -> None:
        self.hass = hass
        self.store = store
        self.config_store = config_store
        self.limiter = FailureLimiter()
        self._sockets: dict[str, set[GuestSocket]] = {}
        self._unsub_config = config_store.async_subscribe(self._on_config_saved)

    @staticmethod
    def now() -> datetime:
        """Current UTC time (patched by tests through dt_util)."""
        return dt_util.utcnow()

    # ─── sockets ─────────────────────────────────────────────────────────────

    def sockets_of(self, pass_id: str) -> set[GuestSocket]:
        """Live sockets of a pass."""
        return self._sockets.get(pass_id, set())

    def add_socket(self, sock: GuestSocket) -> None:
        """Register a socket after successful auth."""
        self._sockets.setdefault(sock.pass_id, set()).add(sock)

    def remove_socket(self, sock: GuestSocket) -> None:
        """Forget a closed socket."""
        group = self._sockets.get(sock.pass_id)
        if group is not None:
            group.discard(sock)
            if not group:
                del self._sockets[sock.pass_id]

    def close_pass(
        self, pass_id: str, code: int = CLOSE_REVOKED, reason: str = "revoked"
    ) -> None:
        """Close every live socket of a pass (revoke, delete, re-pair)."""
        for sock in list(self.sockets_of(pass_id)):
            sock.close_soon(code, reason)

    def close_profile(self, profile_id: str) -> None:
        """Profile changed: guests reconnect and get the new allowlist."""
        for pass_id in self.store.model.passes_of_profile(profile_id):
            for sock in list(self.sockets_of(pass_id)):
                sock.close_soon(CLOSE_PROFILE_CHANGED, "profile_changed")

    def pass_times_changed(self, pass_id: str) -> None:
        """valid_until moved: reschedule the expiry timers."""
        for sock in list(self.sockets_of(pass_id)):
            sock.reschedule_expiry()

    def _on_config_saved(self, _config: dict[str, Any]) -> None:
        for group in list(self._sockets.values()):
            for sock in list(group):
                sock.push_config()

    def shutdown(self) -> None:
        """Integration unloaded: drop listeners and close every guest socket."""
        self._unsub_config()
        for group in list(self._sockets.values()):
            for sock in list(group):
                sock.close_soon(CLOSE_REVOKED, "unloaded")

    # ─── entity facts used by the policy ─────────────────────────────────────

    def device_classes(self, entity_id: str) -> Iterable[str | None]:
        """Live and registry device classes (all of them must be allowed)."""
        classes: set[str | None] = set()
        if state := self.hass.states.get(entity_id):
            classes.add(state.attributes.get("device_class"))
        if entry := er.async_get(self.hass).async_get(entity_id):
            classes.add(entry.device_class)
            classes.add(entry.original_device_class)
        classes.discard(None)
        return classes


def get_runtime(hass: HomeAssistant) -> GuestRuntime | None:
    """The runtime, or None while the integration is not loaded."""
    data = hass.data.get(DOMAIN)
    return data.get("guests") if isinstance(data, dict) else None
