"""Rebuilds JPEG pictures from the pieces the CanSat sends. Pure logic: no files.

A picture is a header (id, size, number of pieces), then pieces of 192 JPEG bytes
in base64, then an end line. A missing piece is filled with zeros so the JPEG still
opens: the picture shows a grey band where the piece was lost."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .config import CHUNK_RAW_BYTES
from .protocol import PictureChunk, PictureHeader


@dataclass
class _InProgress:
    header: PictureHeader
    sat_time: str
    parts: Dict[int, bytes] = field(default_factory=dict)


@dataclass(frozen=True)
class FinishedPicture:
    header: PictureHeader
    sat_time: str
    blob: bytes
    missing: List[int]

    @property
    def complete(self) -> bool:
        return not self.missing

    @property
    def file_name(self) -> str:
        stamp = self.sat_time.replace("-", "").replace(":", "").replace(" ", "_")
        return "img_%04d_%s%s.jpg" % (self.header.image_id, stamp, "" if self.complete else "_PARTIAL")


class PictureAssembler:
    def __init__(self, chunk_bytes: int = CHUNK_RAW_BYTES):
        self._chunk_bytes = chunk_bytes
        self._current: Optional[_InProgress] = None

    @property
    def current(self) -> Optional[PictureHeader]:
        return self._current.header if self._current else None

    def start(self, header: PictureHeader, sat_time: str) -> Optional[FinishedPicture]:
        """Begins a new picture. Returns the previous one if it never got its end line."""
        unfinished = self.finish()
        self._current = _InProgress(header, sat_time)
        return unfinished

    def add(self, chunk: PictureChunk) -> Optional[Tuple[int, int]]:
        """Stores one valid piece of the current picture. Returns (pieces got, total) or None."""
        p = self._current
        if not chunk.valid or not p or p.header.image_id != chunk.image_id:
            return None
        p.parts[chunk.seq] = chunk.data()
        return len(p.parts), p.header.chunks

    def finish(self) -> Optional[FinishedPicture]:
        p, self._current = self._current, None
        if not p:
            return None
        n = p.header.chunks
        missing = [i for i in range(n) if i not in p.parts]
        filler = b"\x00" * self._chunk_bytes
        blob = b"".join(p.parts.get(i, filler) for i in range(n))[: p.header.size]
        return FinishedPicture(p.header, p.sat_time, blob, missing)
