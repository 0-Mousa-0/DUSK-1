import threading
from abc import ABC, abstractmethod
from typing import Callable, Optional

from ..events import EventReporter

LineSink = Callable[[bytes], None]
MAX_LINE = 4096                          # no newline for this long = noise, pass it on


class LineSource(threading.Thread, ABC):
    """A thread that reads lines and hands each one to `sink`. Sources know nothing
    about decoding: they only report when they connect and disconnect."""
    daemon = True

    def __init__(self, label: str, sink: LineSink, events: EventReporter):
        super().__init__(name=f"source: {label}")
        self.label = label
        self._sink = sink
        self._events = events
        self.connected = False
        self.stop_flag = False
        self._write_lock = threading.Lock()

    @abstractmethod
    def run(self) -> None: ...

    def write(self, data: bytes) -> bool:
        """Sends a command line up. Returns False when nothing is connected."""
        return False

    def stop(self) -> None:
        self.stop_flag = True

    # ------------------------------------------------------------- helpers
    def _set_connected(self, on: bool, why: str = "") -> None:
        if on == self.connected:
            return
        self.connected = on
        if on:
            self._events.info("RF", f"Connected to {self.label}")
        else:
            self._events.error("RF", f"Lost connection to {self.label}{': ' + why if why else ''}")

    def _pump(self, read: Callable[[], Optional[bytes]]) -> None:
        """Calls read() until it returns None, splitting the bytes into lines."""
        buf = b""
        while not self.stop_flag:
            data = read()
            if data is None:
                return
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._sink(line)
            if len(buf) > MAX_LINE:
                self._sink(buf)
                buf = b""
