"""What the dashboards see: one MissionState per backend run. Thread-safe."""
import threading
from typing import Optional

from . import messages
from .config import EVENTS_LIMIT, HISTORY_LIMIT, SNAPSHOT_EVENTS, SNAPSHOT_HISTORY

COUNTERS = ("lines", "telemetry", "lost", "noise", "bad_pieces", "pictures_ok", "pictures_partial")


class MissionState:
    def __init__(self, session_name: str):
        self._lock = threading.RLock()
        self.session = session_name
        self.history = []                  # telemetry messages
        self.images = []                   # picture messages
        self.events = []
        self.gs: Optional[dict] = None     # last Ground OBC status
        self.boot: Optional[dict] = None   # last CanSat start-up report
        self.progress: Optional[dict] = None
        self.link = messages.link("CONNECTING", "", False, None)
        self.counters = {name: 0 for name in COUNTERS}
        self.last_line_at = 0.0
        self.last_telemetry_at = 0.0

    # ------------------------------------------------------------- updates
    def count(self, name: str, n: int = 1) -> None:
        with self._lock:
            self.counters[name] += n

    def mark_line(self, now: float) -> None:
        with self._lock:
            self.last_line_at = now
            self.counters["lines"] += 1

    def add_telemetry(self, msg: dict, now: float) -> None:
        with self._lock:
            self.history.append(msg)
            del self.history[:-HISTORY_LIMIT]
            self.counters["telemetry"] += 1
            self.last_telemetry_at = now

    def add_image(self, msg: dict) -> None:
        with self._lock:
            self.images.append(msg)
            self.progress = None
            self.counters["pictures_ok" if msg["complete"] else "pictures_partial"] += 1

    def add_event(self, msg: dict) -> None:
        with self._lock:
            self.events.append(msg)
            del self.events[:-EVENTS_LIMIT]

    def set(self, **fields) -> None:
        """set(gs=..., boot=..., progress=..., link=...)"""
        with self._lock:
            for key, value in fields.items():
                setattr(self, key, value)

    # ------------------------------------------------------------- reads
    def stats(self) -> dict:
        with self._lock:
            return dict(self.counters)

    def snapshot(self, now_ms: int, can_command: bool = False) -> dict:
        """The 'hello' message a dashboard gets when it connects."""
        with self._lock:
            return {"type": "hello", "session": self.session, "link": self.link,
                    "history": self.history[-SNAPSHOT_HISTORY:], "images": list(self.images),
                    "events": self.events[-SNAPSHOT_EVENTS:], "gs": self.gs, "boot": self.boot,
                    "progress": self.progress, "stats": dict(self.counters), "server_ms": now_ms,
                    "can_command": can_command}
