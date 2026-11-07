"""Rate limiting for pairing, guest auth and guest service calls.

No Home Assistant imports. The clock is injectable for tests.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
import time

from .const import (
    CALL_BUCKET_BURST,
    CALL_BUCKET_PER_SECOND,
    FAIL_GLOBAL_LOCK_SECONDS,
    FAIL_LIMIT_GLOBAL,
    FAIL_LIMIT_PER_IP,
    FAIL_LOCKOUT_BASE_SECONDS,
    FAIL_LOCKOUT_MAX_SECONDS,
    FAIL_TRACKED_IPS_MAX,
    FAIL_WINDOW_SECONDS,
)

Clock = Callable[[], float]


@dataclass
class _IpState:
    failures: list[float] = field(default_factory=list)
    locked_until: float = 0.0
    lockouts: int = 0


class FailureLimiter:
    """Counts failed attempts per client IP and globally.

    Per IP: after `per_ip` failures within `window` seconds the IP is locked for
    base * 2^n seconds (n = previous lockouts, capped). Globally: after
    `global_limit` failures within `window` every attempt is refused for
    `global_lock` seconds.
    """

    def __init__(
        self,
        *,
        per_ip: int = FAIL_LIMIT_PER_IP,
        window: float = FAIL_WINDOW_SECONDS,
        lockout_base: float = FAIL_LOCKOUT_BASE_SECONDS,
        lockout_max: float = FAIL_LOCKOUT_MAX_SECONDS,
        global_limit: int = FAIL_LIMIT_GLOBAL,
        global_lock: float = FAIL_GLOBAL_LOCK_SECONDS,
        max_ips: int = FAIL_TRACKED_IPS_MAX,
        clock: Clock = time.monotonic,
    ) -> None:
        self._per_ip = per_ip
        self._window = window
        self._base = lockout_base
        self._max = lockout_max
        self._global_limit = global_limit
        self._global_lock = global_lock
        self._max_ips = max_ips
        self._clock = clock
        self._ips: OrderedDict[str, _IpState] = OrderedDict()
        self._global: list[float] = []
        self._global_locked_until = 0.0

    def retry_after(self, ip: str | None) -> int:
        """Seconds the caller must wait before trying again (0 = allowed)."""
        now = self._clock()
        wait = max(0.0, self._global_locked_until - now)
        state = self._ips.get(ip or "")
        if state is not None:
            wait = max(wait, state.locked_until - now)
        return int(wait + 0.999) if wait > 0 else 0

    def record_failure(self, ip: str | None) -> None:
        """Count a failed attempt."""
        now = self._clock()
        key = ip or ""

        self._global = [t for t in self._global if now - t < self._window]
        self._global.append(now)
        if len(self._global) >= self._global_limit:
            self._global_locked_until = now + self._global_lock
            self._global.clear()

        state = self._ips.pop(key, None) or _IpState()
        self._ips[key] = state  # most recently used last
        state.failures = [t for t in state.failures if now - t < self._window]
        state.failures.append(now)
        if len(state.failures) >= self._per_ip:
            lock = min(self._base * (2**state.lockouts), self._max)
            state.locked_until = now + lock
            state.lockouts += 1
            state.failures.clear()

        while len(self._ips) > self._max_ips:
            self._ips.popitem(last=False)

    def record_success(self, ip: str | None) -> None:
        """A correct code/token clears the counters of that IP."""
        self._ips.pop(ip or "", None)


class TokenBucket:
    """Classic token bucket: `burst` tokens, refilled at `rate` per second."""

    def __init__(
        self,
        *,
        burst: int = CALL_BUCKET_BURST,
        rate: float = CALL_BUCKET_PER_SECOND,
        clock: Clock = time.monotonic,
    ) -> None:
        self._burst = float(burst)
        self._rate = float(rate)
        self._clock = clock
        self._tokens = float(burst)
        self._last = clock()

    def take(self) -> bool:
        """Consume one token; False when the bucket is empty."""
        now = self._clock()
        self._tokens = min(self._burst, self._tokens + (now - self._last) * self._rate)
        self._last = now
        if self._tokens >= 1:
            self._tokens -= 1
            return True
        return False
