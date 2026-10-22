"""The DUSK-1 line protocol. Pure functions: no files, no network, no clock.

Every line the CanSat or the Ground OBC sends is one of these:

    Dusk1-2026-10-20 19:37:32:> pkt 1 | T 23.5 | RH 29.2 | ax +0.08 | ... | n 100 | err 0   telemetry
    Dusk1-2026-10-20 19:37:34:> img 1 start | 320x240 | 3624 bytes | 19 chunks              picture header
    Dusk1-img:> 1 0 /9j/4AAQSkZJRg...*0D                                                    picture piece
    Dusk1-2026-10-20 19:37:34:> img 1 end | 19 chunks | 4.0 s                               picture end
    Dusk1-2026-10-20 19:37:31:> boot | reset power-on | mpu ok | dht ok | cam ok | ...      start-up report
    DUSK1-GS:> status | up 4 | wifi DUSK1-GROUND | ... | pictures 1                          Ground OBC status
    anything else                                                                            console text
"""
import base64
import re
from dataclasses import dataclass
from typing import Optional, Union

SAT_PREFIX = "Dusk1-"
GROUND_PREFIX = "DUSK1-GS:> "
RESYNC_PREFIXES = ("Dusk1-", "DUSK1-GS", "=====", " DUSK-1")

_LINE_RE = re.compile(r"^Dusk1-(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d):> (.*)$")
_CHUNK_RE = re.compile(r"^(Dusk1-img:> (\d+) (\d+) ([A-Za-z0-9+/=]+))\*([0-9A-Fa-f]{2})$")
_IMG_START_RE = re.compile(r"^img (\d+) start \| (\d+)x(\d+) \| (\d+) bytes \| (\d+) chunks")
_IMG_END_RE = re.compile(r"^img (\d+) end")
_ALLOWED_EXTRA = set("°Ωµ·←→²±×–—")


# ------------------------------------------------------------------ records
@dataclass(frozen=True)
class GroundLine:
    """A line written by the Ground OBC itself (DUSK1-GS:> ...)."""
    body: str


@dataclass(frozen=True)
class PictureChunk:
    """One piece of a picture. `valid` is False when its XOR checksum is wrong."""
    image_id: int
    seq: int
    data_b64: str
    valid: bool

    def data(self) -> bytes:
        return base64.b64decode(self.data_b64)


@dataclass(frozen=True)
class SatelliteLine:
    """A timestamped line from the CanSat (Dusk1-<time>:> body)."""
    sat_time: str
    body: str


@dataclass(frozen=True)
class ConsoleLine:
    """Readable text that is not part of the protocol (start-up checks, help, replies)."""
    text: str


Record = Union[GroundLine, PictureChunk, SatelliteLine, ConsoleLine]


@dataclass(frozen=True)
class PictureHeader:
    image_id: int
    width: int
    height: int
    size: int
    chunks: int


# ------------------------------------------------------------------ helpers
def is_clean(text: str) -> bool:
    """True for readable text. ESP32 boot noise (115200 baud read at 57600) is not."""
    if "\ufffd" in text:
        return False
    return all(ch == "\t" or 32 <= ord(ch) < 127 or ch in _ALLOWED_EXTRA for ch in text)


def num(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_pairs(body: str) -> dict:
    """'status | up 125 | laptops 2' -> {'up': '125', 'laptops': '2'} (the first part is the kind)."""
    out = {}
    for part in body.split(" | ")[1:]:
        key, _, value = part.partition(" ")
        out[key] = value
    return out


def parse_fields(body: str) -> dict:
    """'pkt 1 | T 23.5 | |a| 10.09' -> {'pkt': '1', 'T': '23.5', '|a|': '10.09'}.

    Parts are split on ' | ' (with spaces), so the field name '|a|' survives."""
    out = {}
    for part in body.split(" | "):
        key, _, value = part.partition(" ")
        out[key] = value
    return out


def xor_checksum(text: str) -> int:
    x = 0
    for ch in text:
        x ^= ord(ch)
    return x


def parse_line(text: str) -> Record:
    """Classifies one clean line of text."""
    if text.startswith(GROUND_PREFIX):
        return GroundLine(text[len(GROUND_PREFIX):])
    m = _CHUNK_RE.match(text)
    if m:
        signed, iid, seq, b64, cs = m.groups()
        return PictureChunk(int(iid), int(seq), b64, xor_checksum(signed) == int(cs, 16))
    m = _LINE_RE.match(text)
    if m:
        return SatelliteLine(*m.groups())
    return ConsoleLine(text)


def is_telemetry(body: str) -> bool:
    return body.startswith("pkt ")


def parse_picture_header(body: str) -> Optional[PictureHeader]:
    m = _IMG_START_RE.match(body)
    return PictureHeader(*map(int, m.groups())) if m else None


def is_picture_end(body: str) -> bool:
    return bool(_IMG_END_RE.match(body))
