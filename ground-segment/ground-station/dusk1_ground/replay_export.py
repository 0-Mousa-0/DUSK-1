"""Turns a saved raw.log into a replay the public dashboard can play without a backend.

    python -m dusk1_ground --replay raw.log --export-replay web/replay

It runs the real decoder on a virtual clock (so the replay has the exact messages a
live dashboard got, at the original pace) and writes:

    replay.json     {"meta": {...}, "messages": [[t_ms, message], ...]}
    images/*.jpg    every picture of the session
"""
import datetime as dt
import json
import os
from typing import Optional

from . import messages
from .bus import MessageBus
from .clock import VirtualClock, ms
from .decoder import DecoderContext, build_decoder
from .events import EventReporter
from .sources import replay_delay
from .state import MissionState

RECORDED_TYPES = {"telemetry", "image", "img_progress", "event", "console", "gs", "boot"}


class _PictureFolder:
    """SessionStorage for the export: keeps the pictures, ignores everything else."""

    def __init__(self, images_dir: str):
        self.name = "replay"
        self.images_dir = images_dir
        os.makedirs(images_dir, exist_ok=True)

    def save_picture(self, name, blob):
        with open(os.path.join(self.images_dir, name), "wb") as f:
            f.write(blob)

    def write_raw(self, line): pass
    def append_telemetry(self, sat_time, values): pass
    def picture_path(self, name): return None
    def telemetry_csv(self): return b""
    def write_event(self, line): pass
    def close(self): pass


def export_replay(raw_log: str, out_dir: str, title: Optional[str] = None) -> dict:
    clock = VirtualClock(start=0.0)
    state = MissionState("replay")
    bus = MessageBus()
    recorded = []

    def record(msg: dict) -> None:
        if msg["type"] in RECORDED_TYPES:
            recorded.append([ms(clock), msg])
            if msg["type"] == "telemetry":       # the live backend sends counters every second
                recorded.append([ms(clock), messages.stats(state.stats())])

    bus.add_listener(record)
    events = EventReporter(state, bus, clock)
    ctx = DecoderContext(state, bus, events, _PictureFolder(os.path.join(out_dir, "images")), clock,
                         picture_url="images/")
    decoder = build_decoder(ctx)
    with open(raw_log, "rb") as f:
        lines = f.read().split(b"\n")
    for line in lines:
        decoder.feed(line)
        clock.advance(replay_delay(line))
    decoder.close()

    counters = state.stats()
    meta = {"title": title or os.path.basename(raw_log), "source": os.path.basename(raw_log),
            "exported": dt.datetime.now().isoformat(timespec="seconds"),
            "duration_s": round(clock.now()), "telemetry": counters["telemetry"], "lost": counters["lost"],
            "pictures_ok": counters["pictures_ok"], "pictures_partial": counters["pictures_partial"],
            "first_cansat_time": state.history[0]["t"] if state.history else None}
    with open(os.path.join(out_dir, "replay.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "messages": recorded}, f, ensure_ascii=False, separators=(",", ":"))
    return meta
