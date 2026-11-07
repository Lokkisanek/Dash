"""Failure limiter (pairing / auth) and call token bucket."""

from _loader import load

rl = load("guest_ratelimit")


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_ip_locked_after_five_failures() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock)
    for _ in range(4):
        limiter.record_failure("198.51.100.1")
        assert limiter.retry_after("198.51.100.1") == 0
    limiter.record_failure("198.51.100.1")
    assert limiter.retry_after("198.51.100.1") == 60
    assert limiter.retry_after("198.51.100.2") == 0  # other IPs unaffected


def test_backoff_doubles_and_caps() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock, lockout_max=300)
    waits = []
    for _ in range(5):
        for _ in range(5):
            limiter.record_failure("ip")
        waits.append(limiter.retry_after("ip"))
        clock.t += waits[-1]
    assert waits == [60, 120, 240, 300, 300]


def test_failures_outside_window_forgotten() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock)
    for _ in range(4):
        limiter.record_failure("ip")
    clock.t += 61
    limiter.record_failure("ip")
    assert limiter.retry_after("ip") == 0


def test_success_resets_ip() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock)
    for _ in range(4):
        limiter.record_failure("ip")
    limiter.record_success("ip")
    limiter.record_failure("ip")
    assert limiter.retry_after("ip") == 0


def test_global_cap_blocks_everyone() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock, global_limit=10, global_lock=60)
    for i in range(10):
        limiter.record_failure(f"10.0.0.{i}")
    assert limiter.retry_after("192.0.2.77") == 60
    clock.t += 60
    assert limiter.retry_after("192.0.2.77") == 0


def test_tracked_ips_bounded() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock, max_ips=100, global_limit=10**9)
    for i in range(1000):
        limiter.record_failure(f"ip{i}")
    assert len(limiter._ips) == 100


def test_none_ip_is_tracked_as_one_key() -> None:
    clock = Clock()
    limiter = rl.FailureLimiter(clock=clock)
    for _ in range(5):
        limiter.record_failure(None)
    assert limiter.retry_after(None) == 60


def test_token_bucket_burst_and_refill() -> None:
    clock = Clock()
    bucket = rl.TokenBucket(burst=3, rate=1, clock=clock)
    assert [bucket.take() for _ in range(4)] == [True, True, True, False]
    clock.t += 1
    assert bucket.take() is True
    assert bucket.take() is False
    clock.t += 100
    assert sum(bucket.take() for _ in range(10)) == 3
