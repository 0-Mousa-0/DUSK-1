"""Turns raw lines into state changes and dashboard messages.

StreamDecoder only does the common work (save the raw bytes, hide boot noise,
classify the line) and then asks a chain of LineHandlers, one per kind of line.
A new kind of line = a new handler; the others do not change (open/closed)."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Iterable, List, Optional

from . import messages, protocol
from .bus import Publisher
from .clock import Clock, ms
from .config import INTEGER_FIELDS, JSON_KEY, TELEMETRY_FIELDS
from .events import EventReporter
from .pictures import FinishedPicture, PictureAssembler
from .protocol import ConsoleLine, GroundLine, PictureChunk, Record, SatelliteLine
from .state import MissionState
from .storage import SessionStorage


@dataclass
class DecoderContext:
    """Everything a handler may use. Handlers depend on this, not on each other."""
    state: MissionState
    bus: Publisher
    events: EventReporter
    storage: SessionStorage
    clock: Clock
    picture_url: str = "/images/"        # where dashboards fetch saved pictures


class LineHandler(ABC):
    def __init__(self, ctx: DecoderContext):
        self.ctx = ctx

    @abstractmethod
    def handle(self, record: Record, text: str) -> bool:
        """Returns True when this handler took care of the line."""

    def close(self) -> None:
        """Called once when the backend stops."""


class PacketTracker:
    """Remembers the last telemetry packet number to find lost lines. Shared by the
    telemetry handler (which counts gaps) and the boot handler (which resets it)."""

    def __init__(self):
        self.last: Optional[int] = None


# ================================================================ handlers
class GroundStatusHandler(LineHandler):
    """DUSK1-GS:> lines written by the Ground OBC (UNO R4 WiFi)."""

    def handle(self, record, text):
        if not isinstance(record, GroundLine):
            return False
        body, ctx = record.body, self.ctx
        if body.startswith("status"):
            gs = messages.ground_status(ms(ctx.clock), body, protocol.parse_pairs(body))
            ctx.state.set(gs=gs)
            ctx.bus.publish(gs)
        elif body.startswith("uplink"):
            ctx.events.info("COMMAND", "Ground OBC sent up: " + body[9:])
        elif body.startswith("lost"):
            pass                                 # the backend counts lost lines itself
        else:
            ctx.events.info("GROUND", "Ground OBC: " + body)
        return True


class PictureHandler(LineHandler):
    """Picture header, pieces and end line."""

    def __init__(self, ctx, assembler: PictureAssembler = None):
        super().__init__(ctx)
        self.assembler = assembler or PictureAssembler()

    def handle(self, record, text):
        if isinstance(record, PictureChunk):
            self._piece(record)
            return True
        if isinstance(record, SatelliteLine):
            header = protocol.parse_picture_header(record.body)
            if header:
                self._publish(self.assembler.start(header, record.sat_time))
                progress = messages.picture_progress(header.image_id, 0, header.chunks, header.width,
                                                     header.height, header.size)
                self.ctx.state.set(progress=progress)
                self.ctx.bus.publish(progress)
                self.ctx.events.info("CAMERA", f"Picture {header.image_id} incoming: {header.width}x"
                                     f"{header.height}, {header.size} bytes, {header.chunks} pieces")
                return True
            if protocol.is_picture_end(record.body):
                self._publish(self.assembler.finish())
                return True
        return False

    def _piece(self, chunk: PictureChunk) -> None:
        ctx = self.ctx
        if not chunk.valid:
            ctx.state.count("bad_pieces")
            ctx.events.warning("CAMERA", f"Damaged picture piece {chunk.seq} of picture {chunk.image_id} dropped")
            return
        got = self.assembler.add(chunk)
        if not got:
            return
        header = self.assembler.current
        progress = messages.picture_progress(header.image_id, got[0], got[1], header.width, header.height,
                                             header.size)
        ctx.state.set(progress=progress)
        if got[0] % 3 == 0 or got[0] == got[1]:   # every 3rd piece is enough for the progress bar
            ctx.bus.publish(progress)

    def _publish(self, pic: Optional[FinishedPicture]) -> None:
        if not pic:
            return
        ctx, h = self.ctx, pic.header
        name = pic.file_name
        ctx.storage.save_picture(name, pic.blob)
        msg = messages.picture(h.image_id, ctx.picture_url + name, name, h.width, h.height, h.size,
                               len(pic.missing), h.chunks, pic.sat_time, ms(ctx.clock))
        ctx.state.add_image(msg)
        ctx.bus.publish(msg)
        if pic.complete:
            ctx.events.info("CAMERA", f"Picture {h.image_id} complete: {name}")
        else:
            ctx.events.warning("CAMERA", f"Picture {h.image_id} saved with {len(pic.missing)} of {h.chunks} "
                                         "pieces missing")

    def close(self):
        self._publish(self.assembler.finish())


class TelemetryHandler(LineHandler):
    """pkt lines: one per second, saved to telemetry.csv and pushed to dashboards."""

    def __init__(self, ctx, packets: PacketTracker):
        super().__init__(ctx)
        self.packets = packets

    def handle(self, record, text):
        if not (isinstance(record, SatelliteLine) and protocol.is_telemetry(record.body)):
            return False
        ctx = self.ctx
        raw = protocol.parse_fields(record.body)
        self._track_packet(raw.get("pkt"))
        values = {}
        for key in TELEMETRY_FIELDS:
            v = protocol.num(raw.get(key))
            if key in INTEGER_FIELDS and v is not None:
                v = int(v)
            values[JSON_KEY.get(key, key)] = v
        msg = messages.telemetry(record.sat_time, ms(ctx.clock), values)
        ctx.state.add_telemetry(msg, ctx.clock.now())
        ctx.storage.append_telemetry(record.sat_time, [raw.get(k, "") for k in TELEMETRY_FIELDS])
        ctx.bus.publish(msg)
        return True

    def _track_packet(self, value) -> None:
        pkt = protocol.num(value)
        pkt = int(pkt) if pkt is not None else None
        last = self.packets.last
        if pkt is not None and last is not None:
            if pkt > last + 1:
                gap = pkt - last - 1
                self.ctx.state.count("lost", gap)
                self.ctx.events.warning("RF", f"Lost {gap} line(s) before pkt {pkt}")
            elif pkt <= last:
                self.ctx.events.info("BOOT", "Packet counter restarted (CanSat rebooted)")
        self.packets.last = pkt


class BootHandler(LineHandler):
    """The CanSat's one-line start-up report."""

    def __init__(self, ctx, packets: PacketTracker):
        super().__init__(ctx)
        self.packets = packets

    def handle(self, record, text):
        if not (isinstance(record, SatelliteLine) and record.body.startswith("boot")):
            return False
        ctx, body = self.ctx, record.body
        self.packets.last = None
        boot = messages.boot(record.sat_time, ms(ctx.clock), body, protocol.parse_pairs(body))
        ctx.state.set(boot=boot)
        ctx.bus.publish(boot)
        ctx.events.info("BOOT", f"CanSat started: {body}")
        return True


class ClockSetHandler(LineHandler):
    """The CanSat confirms a new date and time."""

    def handle(self, record, text):
        if not (isinstance(record, SatelliteLine) and record.body.startswith("clock set")):
            return False
        self.ctx.events.info("COMMAND", f"CanSat clock set to {record.sat_time}")
        self.ctx.bus.publish(messages.console(ms(self.ctx.clock), text))
        return True


class ConsoleHandler(LineHandler):
    """Everything else readable: start-up checks, help text, replies to keys."""

    def handle(self, record, text):
        if isinstance(record, (ConsoleLine, SatelliteLine)):
            self.ctx.bus.publish(messages.console(ms(self.ctx.clock), text))
            return True
        return False


# ================================================================ noise
class BootNoiseFilter:
    """At every reset the ESP32 prints its own boot text at 115200 baud, which reads as
    garbage at 57600. Hide it until the next real protocol line."""

    def __init__(self, ctx: DecoderContext):
        self.ctx = ctx
        self.noise_mode = False

    def accept(self, raw: bytes) -> Optional[str]:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        if text is None or not protocol.is_clean(text):
            if not self.noise_mode:
                self.ctx.events.info("BOOT", "CanSat restarted (its boot text is hidden)")
            self.noise_mode = True
            self.ctx.state.count("noise")
            return None
        if self.noise_mode and not text.startswith(protocol.RESYNC_PREFIXES):
            self.ctx.state.count("noise")
            return None
        self.noise_mode = False
        return text


# ================================================================ decoder
class StreamDecoder:
    def __init__(self, ctx: DecoderContext, handlers: Iterable[LineHandler], noise: BootNoiseFilter):
        self.ctx = ctx
        self.handlers: List[LineHandler] = list(handlers)
        self.noise = noise

    def feed(self, raw: bytes) -> None:
        """One line of bytes from the source, without the newline."""
        self.ctx.storage.write_raw(raw + b"\n")
        raw = raw.rstrip(b"\r")
        if not raw.strip():
            return
        self.ctx.state.mark_line(self.ctx.clock.now())
        text = self.noise.accept(raw)
        if text is None:
            return
        record = protocol.parse_line(text)
        for handler in self.handlers:
            if handler.handle(record, text):
                return

    def close(self) -> None:
        for handler in self.handlers:
            handler.close()


def build_decoder(ctx: DecoderContext) -> StreamDecoder:
    """The standard handler chain. The order matters: the console handler is the fallback."""
    packets = PacketTracker()
    handlers = [GroundStatusHandler(ctx), PictureHandler(ctx), TelemetryHandler(ctx, packets),
                BootHandler(ctx, packets), ClockSetHandler(ctx), ConsoleHandler(ctx)]
    return StreamDecoder(ctx, handlers, BootNoiseFilter(ctx))
