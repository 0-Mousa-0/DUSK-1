"""Commands from a dashboard up to the CanSat (laptop -> Ground OBC -> radio -> CanSat).

A command reaches real flight hardware, so the policy is strict: only a browser on
the ground station laptop itself may send one. Anyone who reaches the backend through
the public link (a Cloudflare tunnel) or any other proxy is a read-only viewer."""
import ipaddress
from typing import Callable, Mapping, Optional, Tuple

from .config import COMMAND_MAX_LEN
from .events import EventReporter
from .sources import LineSource

PROXY_HEADERS = ("cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded", "cf-ray")


class CommandPolicy:
    def __init__(self, allow_lan: bool = False):
        self.allow_lan = allow_lan          # --lan-commands: laptops on the same private network too

    def may_command(self, client_ip: str, headers: Mapping[str, str]) -> bool:
        try:
            ip = ipaddress.ip_address(client_ip)
            trusted = ip.is_loopback or (self.allow_lan and ip.is_private)
        except ValueError:
            trusted = False
        lower = {k.lower() for k in headers.keys()}
        return trusted and not any(h in lower for h in PROXY_HEADERS)


class CommandService:
    def __init__(self, source: Callable[[], Optional[LineSource]], events: EventReporter):
        self._source = source
        self._events = events

    def send(self, text: str) -> Tuple[bool, str]:
        text = (text or "").strip()
        if not text or len(text) > COMMAND_MAX_LEN or "\n" in text:
            return False, "empty command" if not text else "command too long or has a line break"
        src = self._source()
        ok = bool(src and src.write((text + "\n").encode("utf-8")))
        if ok:
            self._events.info("COMMAND", f"Sent: {text}")
            return True, "sent"
        self._events.error("COMMAND", f"Could not send: {text}")
        return False, "no connection to the ground OBC / radio"
