"""Mission events ("Lost 3 lines", "Picture 7 complete", ...).

EventReporter is the only place that creates them. Where they end up (the session's
events.log, the console window) is decided by the sinks it is given."""
import datetime as dt
from typing import Callable, Iterable

from . import messages
from .bus import Publisher
from .clock import Clock, ms
from .state import MissionState

EventSink = Callable[[str], None]       # gets "2026-10-21 18:27:38  INFO    RF        Link: LIVE"


class EventReporter:
    def __init__(self, state: MissionState, bus: Publisher, clock: Clock, sinks: Iterable[EventSink] = ()):
        self._state, self._bus, self._clock = state, bus, clock
        self._sinks = list(sinks)

    def report(self, severity: str, category: str, text: str) -> dict:
        ev = messages.event(ms(self._clock), severity, category, text)
        self._state.add_event(ev)
        stamp = dt.datetime.fromtimestamp(self._clock.now()).strftime("%Y-%m-%d %H:%M:%S")
        line = f"{stamp}  {severity:7s} {category:9s} {text}"
        for sink in self._sinks:
            sink(line)
        self._bus.publish(ev)
        return ev

    def info(self, category: str, text: str) -> dict:
        return self.report("INFO", category, text)

    def warning(self, category: str, text: str) -> dict:
        return self.report("WARNING", category, text)

    def error(self, category: str, text: str) -> dict:
        return self.report("ERROR", category, text)


def console_printer(line: str) -> None:
    """Event sink for the backend's console window: the time only, not the date."""
    print(line[11:], flush=True)
