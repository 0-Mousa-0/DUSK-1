"""Time source. The backend asks a Clock instead of calling time.time(), so the same
decoder can run live (real time), export a replay (virtual time) or run in tests."""
import time
from typing import Protocol


class Clock(Protocol):
    def now(self) -> float:
        """Seconds since the epoch."""


class SystemClock:
    def now(self) -> float:
        return time.time()


class VirtualClock:
    """A clock that only moves when told to. Used by the replay exporter and the tests."""

    def __init__(self, start: float = 0.0):
        self._t = start

    def now(self) -> float:
        return self._t

    def advance(self, seconds: float) -> None:
        self._t += seconds


def ms(clock: Clock) -> int:
    return int(clock.now() * 1000)
