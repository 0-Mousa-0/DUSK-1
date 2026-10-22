"""The link state every dashboard shows in its header:

    CONNECTING  the source (Wi-Fi / USB) is not open yet
    WAITING     the source is open, no telemetry has arrived yet
    LIVE        telemetry arrived in the last 5 s
    NO DATA     the source is open but telemetry stopped
"""
import threading
import time
from typing import Optional

from . import messages
from .bus import Publisher
from .clock import Clock
from .config import STALE_AFTER_S
from .events import EventReporter
from .sources import LineSource
from .state import MissionState


def link_state(connected: bool, last_telemetry_at: float, now: float, stale_after: float = STALE_AFTER_S) -> str:
    if not connected:
        return "CONNECTING"
    if not last_telemetry_at:
        return "WAITING"
    return "LIVE" if now - last_telemetry_at < stale_after else "NO DATA"


class LinkMonitor(threading.Thread):
    daemon = True

    def __init__(self, state: MissionState, source: Optional[LineSource], bus: Publisher,
                 events: EventReporter, clock: Clock, period_s: float = 1.0):
        super().__init__(name="link monitor")
        self.state, self.source, self.bus, self.events, self.clock = state, source, bus, events, clock
        self.period_s = period_s
        self._last: Optional[str] = None

    def tick(self) -> str:
        now, src = self.clock.now(), self.source
        connected = bool(src and src.connected)
        last_tele = self.state.last_telemetry_at
        state = link_state(connected, last_tele, now)
        age = round(now - last_tele, 1) if last_tele else None
        msg = messages.link(state, src.label if src else "", connected, age)
        self.state.set(link=msg)
        if state != self._last:
            if self._last is not None:
                if state == "LIVE":
                    self.events.info("RF", f"Link: {state}")
                else:
                    self.events.warning("RF", f"Link: {state}")
            self._last = state
        self.bus.publish(msg)
        self.bus.publish(messages.stats(self.state.stats()))
        return state

    def run(self):
        while True:
            self.tick()
            time.sleep(self.period_s)
