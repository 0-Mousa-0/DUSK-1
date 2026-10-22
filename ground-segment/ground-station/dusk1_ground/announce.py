"""Puts the live link on the public dashboard itself.

With --share, once the Cloudflare tunnel has its address, PagesAnnouncer stores it in the
repository's Actions variable LIVE_URL and re-runs the GitHub Pages workflow, which writes
it to live.json. About a minute later https://0-mousa-0.github.io/DUSK-1/ opens the live
data by itself; once this laptop stops, the dashboard finds the link dead and plays the
recorded session again. Needs the GitHub CLI (gh), logged in to an account that may write
to the repository."""
import json
import subprocess
import threading
import time
import urllib.request
from typing import Callable, Optional

from .config import (PAGES_BRANCH, PAGES_LIVE_VARIABLE, PAGES_REPO, PAGES_UPDATE_TIMEOUT_S, PAGES_WORKFLOW,
                     PUBLIC_DASHBOARD_URL)
from .events import EventReporter
from .sharing import find_program

GH_WINDOWS_PATHS = (r"C:\Program Files\GitHub CLI\gh.exe",
                    r"%LOCALAPPDATA%\Microsoft\WinGet\Links\gh.exe",
                    r"%LOCALAPPDATA%\Programs\dusk1-tools\gh.exe")


def read_live_json(pages_url: str) -> Optional[str]:
    """The live address the public dashboard announces right now, if any."""
    with urllib.request.urlopen(f"{pages_url.rstrip('/')}/live.json?t={int(time.time())}", timeout=10) as r:
        return json.loads(r.read().decode("utf-8")).get("url")


class PagesAnnouncer:
    """A tunnel listener: announce(public_url) points the public dashboard at it."""

    def __init__(self, events: EventReporter, pages_url: str = PUBLIC_DASHBOARD_URL, repo: str = PAGES_REPO,
                 gh: Optional[str] = None, run: Callable = subprocess.run, read_live: Callable = read_live_json,
                 sleep: Callable[[float], None] = time.sleep, poll_s: float = 10,
                 timeout_s: float = PAGES_UPDATE_TIMEOUT_S):
        self.events = events
        self.pages_url = pages_url
        self.repo = repo
        self.gh = gh
        self.run = run
        self.read_live = read_live
        self.sleep = sleep
        self.poll_s = poll_s
        self.timeout_s = timeout_s

    def __call__(self, public_url: str) -> None:
        threading.Thread(target=self.announce, args=(public_url,), name="pages-announce", daemon=True).start()

    def announce(self, public_url: str) -> bool:
        gh = self.gh or find_program("gh", GH_WINDOWS_PATHS)
        if not gh:
            self.events.warning("SYSTEM", "The public dashboard keeps playing the recording: install the GitHub CLI "
                                          "(gh) and run `gh auth login` to show live data there")
            return False
        steps = ([gh, "variable", "set", PAGES_LIVE_VARIABLE, "--repo", self.repo, "--body", public_url],
                 [gh, "workflow", "run", PAGES_WORKFLOW, "--repo", self.repo, "--ref", PAGES_BRANCH])
        for cmd in steps:
            try:
                r = self.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
                why = (r.stderr or r.stdout or "").strip().splitlines() if r.returncode else None
            except (OSError, subprocess.TimeoutExpired) as e:
                why = [str(e)]
            if why is not None:
                self.events.warning("SYSTEM", "Could not put the live link on the public dashboard: "
                                              + (why[-1] if why else "gh failed"))
                return False
        self.events.info("SYSTEM", f"Updating the public dashboard {self.pages_url} to show this live link "
                                   "(about a minute)")
        return self.wait_until_live(public_url)

    def wait_until_live(self, public_url: str) -> bool:
        waited = 0.0
        while waited < self.timeout_s:
            self.sleep(self.poll_s)
            waited += self.poll_s
            try:
                if self.read_live(self.pages_url) == public_url:
                    self.events.info("SYSTEM", f"Public dashboard is live: {self.pages_url}")
                    return True
            except Exception:
                pass                                   # not deployed yet
        self.events.warning("SYSTEM", "The public dashboard has not picked up the live link yet; "
                                      "the ?live= link works meanwhile")
        return False
