"""Where the lines come from. Every source is a LineSource, so the rest of the backend
does not care which one runs (Liskov): Wi-Fi from the Ground OBC, USB serial, or a replay."""
from .base import LineSource
from .replay import ReplaySource, replay_delay
from .serial_port import SerialSource
from .tcp import TcpSource

__all__ = ["LineSource", "TcpSource", "SerialSource", "ReplaySource", "replay_delay"]
