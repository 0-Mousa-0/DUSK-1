"""The session folder. Every run of the backend saves into its own folder:

    dusk1_data/session_<date>_<time>/
        telemetry.csv   one row per telemetry line
        images/         every picture as a .jpg (_PARTIAL if pieces are missing)
        raw.log         every byte received, for replay later
        events.log      what happened, with times
"""
import csv
import datetime as dt
import os
from typing import Optional, Protocol, Sequence

from .config import TELEMETRY_FIELDS


class SessionStorage(Protocol):
    name: str

    def write_raw(self, line: bytes) -> None: ...
    def append_telemetry(self, sat_time: str, values: Sequence[str]) -> None: ...
    def save_picture(self, name: str, blob: bytes) -> None: ...
    def picture_path(self, name: str) -> Optional[str]: ...
    def telemetry_csv(self) -> bytes: ...
    def write_event(self, line: str) -> None: ...
    def close(self) -> None: ...


class FileSessionStorage:
    def __init__(self, data_dir: str, started: dt.datetime):
        self.name = "session_" + started.strftime("%Y%m%d_%H%M%S")
        self.path = os.path.join(data_dir, self.name)
        self.images_dir = os.path.join(self.path, "images")
        os.makedirs(self.images_dir, exist_ok=True)
        self._csv_file = open(os.path.join(self.path, "telemetry.csv"), "w", newline="", encoding="utf-8")
        self._csv = csv.writer(self._csv_file)
        self._csv.writerow(["laptop_time", "cansat_time", *TELEMETRY_FIELDS])
        self._raw = open(os.path.join(self.path, "raw.log"), "ab")
        self._events = open(os.path.join(self.path, "events.log"), "a", encoding="utf-8")

    def write_raw(self, line: bytes) -> None:
        self._raw.write(line)
        self._raw.flush()                   # a few lines per second: always flushed, nothing lost on a crash

    def append_telemetry(self, sat_time: str, values: Sequence[str]) -> None:
        self._csv.writerow([dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), sat_time, *values])
        self._csv_file.flush()

    def save_picture(self, name: str, blob: bytes) -> None:
        with open(os.path.join(self.images_dir, name), "wb") as f:
            f.write(blob)

    def picture_path(self, name: str) -> Optional[str]:
        name = os.path.basename(name)
        path = os.path.join(self.images_dir, name)
        return path if name.endswith(".jpg") and os.path.isfile(path) else None

    def telemetry_csv(self) -> bytes:
        self._csv_file.flush()
        with open(os.path.join(self.path, "telemetry.csv"), "rb") as f:
            return f.read()

    def write_event(self, line: str) -> None:
        self._events.write(line + "\n")
        self._events.flush()

    def close(self) -> None:
        for f in (self._csv_file, self._raw, self._events):
            f.close()
