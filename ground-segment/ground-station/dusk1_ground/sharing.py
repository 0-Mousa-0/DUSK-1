"""Public read-only live link through a free Cloudflare quick tunnel.

    python -m dusk1_ground --serial COM5 --share

starts `cloudflared tunnel --url http://localhost:8080`, which prints an address like
https://some-words.trycloudflare.com. Anyone can open that address (the full live
dashboard), or the public dashboard on GitHub Pages with ?live=<that address>.
Visitors are read-only: see commands.CommandPolicy. The address changes every run."""
import os
import re
import shutil
import subprocess
import threading
from typing import Optional
from urllib.parse import quote

from .events import EventReporter

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
WINDOWS_PATHS = (r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
                 r"C:\Program Files\cloudflared\cloudflared.exe",
                 r"%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe",
                 r"%LOCALAPPDATA%\Programs\dusk1-tools\cloudflared.exe")


def find_cloudflared() -> Optional[str]:
    found = shutil.which("cloudflared")
    if found:
        return found
    return next((p for p in map(os.path.expandvars, WINDOWS_PATHS) if os.path.isfile(p)), None)


class CloudflareTunnel:
    def __init__(self, local_port: int, events: EventReporter, pages_url: str):
        self.local_port = local_port
        self.events = events
        self.pages_url = pages_url
        self.public_url: Optional[str] = None
        self._proc: Optional[subprocess.Popen] = None

    def start(self) -> bool:
        exe = find_cloudflared()
        if not exe:
            self.events.error("SYSTEM", "The public link needs cloudflared: winget install Cloudflare.cloudflared")
            return False
        self._proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--url", f"http://localhost:{self.local_port}"],
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                      encoding="utf-8", errors="replace")
        threading.Thread(target=self._watch, name="cloudflared", daemon=True).start()
        self.events.info("SYSTEM", "Opening the public read-only link (Cloudflare tunnel) ...")
        return True

    def _watch(self) -> None:
        for line in self._proc.stdout:
            m = URL_RE.search(line)
            if m and not self.public_url:
                self.public_url = m.group(0)
                dashboard = f"{self.pages_url}?live={quote(self.public_url, safe=':/')}"
                self.events.info("SYSTEM", f"Public read-only link: {self.public_url}")
                self.events.info("SYSTEM", f"Public dashboard: {dashboard}")
                print("\n  Share this link (read-only, live):\n    " + dashboard + "\n", flush=True)
        if self._proc.poll() is not None:
            self.events.warning("SYSTEM", "The public link closed (cloudflared stopped)")

    def stop(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
