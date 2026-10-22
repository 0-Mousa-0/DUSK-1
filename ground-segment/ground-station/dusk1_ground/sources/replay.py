import os
import time

from ..config import REPLAY_DELAY_S
from .base import LineSource


def replay_delay(line: bytes) -> float:
    """How long this kind of line took on the real link (telemetry: 1 per second)."""
    if b":> pkt " in line:
        return REPLAY_DELAY_S["telemetry"]
    if line.startswith(b"Dusk1-img:> "):
        return REPLAY_DELAY_S["chunk"]
    return REPLAY_DELAY_S["other"]


class ReplaySource(LineSource):
    """Plays a saved raw.log back at real speed."""

    def __init__(self, path: str, speed: float, loop: bool, sink, events, sleep=time.sleep):
        super().__init__(f"replay of {os.path.basename(path)}", sink, events)
        self.path, self.speed, self.loop = path, speed, loop
        self._sleep = sleep

    def run(self):
        self._set_connected(True)
        while not self.stop_flag:
            with open(self.path, "rb") as f:
                lines = f.read().split(b"\n")
            for line in lines:
                if self.stop_flag:
                    return
                self._sink(line)
                self._sleep(replay_delay(line) / self.speed)
            if not self.loop:
                break
        self._events.info("SYSTEM", "Replay finished")

    def write(self, data):
        self._events.info("COMMAND", "Replay mode: command not sent anywhere")
        return True
