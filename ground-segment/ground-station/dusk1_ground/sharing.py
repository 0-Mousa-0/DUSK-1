"""Public read-only live link through a free Cloudflare quick tunnel.

    python -m dusk1_ground --serial COM5 --share

starts `cloudflared tunnel --url http://localhost:8080`, which prints an address like
https://some-words.trycloudflare.com. Anyone can open that address (the full live
dashboard), or the public dashboard on GitHub Pages with ?live=<that address>; the
listeners (announce.PagesAnnouncer) also put it on the public dashboard itself.
Visitors are read-only: see commands.CommandPolicy. The address changes every run."""
import os
import re
import shutil
import subprocess
import threading
import time
from typing import Callable, Iterable, Optional, Sequence
from urllib.parse import quote

from .config import TUNNEL_RETRY_MAX_S, TUNNEL_RETRY_S
from .events import EventReporter

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
WINDOWS_PATHS = (r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
                 r"C:\Program Files\cloudflared\cloudflared.exe",
                 r"%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe",
                 r"%LOCALAPPDATA%\Programs\dusk1-tools\cloudflared.exe")


def find_program(name: str, windows_paths: Sequence[str]) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    return next((p for p in map(os.path.expandvars, windows_paths) if os.path.isfile(p)), None)


def find_cloudflared() -> Optional[str]:
    return find_program("cloudflared", WINDOWS_PATHS)


class CloudflareTunnel:
    """Keeps a quick tunnel open: when cloudflared stops, a new one starts (with a new address)."""

    def __init__(self, local_port: int, events: EventReporter, pages_url: str,
                 listeners: Iterable[Callable[[str], None]] = (), popen: Callable = subprocess.Popen,
                 sleep: Callable[[float], None] = time.sleep):
        self.local_port = local_port
        self.events = events
        self.pages_url = pages_url
        self.listeners = list(listeners)          # told every new public address
        self.public_url: Optional[str] = None
        self.popen = popen
        self.sleep = sleep
        self._proc: Optional[subprocess.Popen] = None
        self._stopped = False

    def start(self) -> bool:
        exe = find_cloudflared()
        if not exe:
            self.events.error("SYSTEM", "The public link needs cloudflared: winget install Cloudflare.cloudflared")
            return False
        threading.Thread(target=self._run, args=(exe,), name="cloudflared", daemon=True).start()
        self.events.info("SYSTEM", "Opening the public read-only link (Cloudflare tunnel) ...")
        return True

    def _run(self, exe: str) -> None:
        delay = TUNNEL_RETRY_S
        while not self._stopped:
            # HTTP/2 over TCP 443: some networks (school, campus) let QUIC start, then starve it
            self._proc = self.popen([exe, "tunnel", "--no-autoupdate", "--protocol", "http2",
                                     "--url", f"http://localhost:{self.local_port}"],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    encoding="utf-8", errors="replace")
            last = self._watch(self._proc)
            if self._stopped:
                return
            delay = TUNNEL_RETRY_S if self.public_url else min(TUNNEL_RETRY_MAX_S, delay * 2)
            self.public_url = None
            self.events.warning("SYSTEM", f"The public link closed (cloudflared: {last or 'stopped'}); "
                                          f"opening a new one in {delay:.0f} s")
            self.sleep(delay)

    def _watch(self, proc) -> str:
        """Reads cloudflared until it stops; returns its last words."""
        last = ""
        for line in proc.stdout:
            last = line.strip() or last
            m = URL_RE.search(line)
            if m and not self.public_url:
                self._announce(m.group(0))
        proc.wait()
        return last[-160:]

    def _announce(self, url: str) -> None:
        self.public_url = url
        dashboard = f"{self.pages_url}?live={quote(url, safe=':/')}"
        self.events.info("SYSTEM", f"Public read-only link: {url}")
        self.events.info("SYSTEM", f"Public dashboard: {dashboard}")
        print("\n  Share this link (read-only, live):\n    " + dashboard + "\n", flush=True)
        for listener in self.listeners:
            listener(url)

    def stop(self) -> None:
        self._stopped = True
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
