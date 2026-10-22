"""Test doubles: an in-memory session and a fully wired decoder on a virtual clock."""
from dusk1_ground.bus import MessageBus
from dusk1_ground.clock import VirtualClock
from dusk1_ground.decoder import DecoderContext, build_decoder
from dusk1_ground.events import EventReporter
from dusk1_ground.protocol import xor_checksum
from dusk1_ground.state import MissionState


class MemoryStorage:
    name = "session_test"

    def __init__(self):
        self.raw, self.rows, self.pictures, self.event_lines = [], [], {}, []

    def write_raw(self, line): self.raw.append(line)
    def append_telemetry(self, sat_time, values): self.rows.append([sat_time, *values])
    def save_picture(self, name, blob): self.pictures[name] = blob
    def picture_path(self, name): return None
    def telemetry_csv(self): return b"laptop_time,cansat_time\n"
    def write_event(self, line): self.event_lines.append(line)
    def close(self): pass


class Rig:
    """Everything the decoder needs, with every published message recorded."""

    def __init__(self):
        self.clock = VirtualClock(1_700_000_000.0)
        self.state = MissionState("session_test")
        self.bus = MessageBus()
        self.published = []
        self.bus.add_listener(self.published.append)
        self.storage = MemoryStorage()
        self.events = EventReporter(self.state, self.bus, self.clock, sinks=[self.storage.write_event])
        self.decoder = build_decoder(DecoderContext(self.state, self.bus, self.events, self.storage, self.clock))

    def feed(self, *lines: str) -> None:
        for line in lines:
            self.decoder.feed(line.encode("utf-8"))
            self.clock.advance(0.1)

    def of_type(self, kind: str):
        return [m for m in self.published if m["type"] == kind]

    def event_texts(self):
        return [m["msg"] for m in self.of_type("event")]


def telemetry_line(pkt: int, t="2026-10-20 19:37:32", temp="23.5") -> str:
    return (f"Dusk1-{t}:> pkt {pkt} | T {temp} | RH 29.2 | ax +0.08 | ay -0.25 | az +10.04 | |a| 10.09 | "
            f"gx -0.92 | gy -1.54 | gz -0.00 | roll +3.1 | pitch +4.8 | n 100 | err 0")


def chunk_line(image_id: int, seq: int, b64: str, corrupt=False) -> str:
    body = f"Dusk1-img:> {image_id} {seq} {b64}"
    cs = xor_checksum(body) ^ (0x01 if corrupt else 0)
    return f"{body}*{cs:02X}"
