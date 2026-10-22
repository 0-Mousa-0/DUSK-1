"""HTTP API and web server.

    GET  /                    the dashboard (web/index.html) and its css/, js/, assets/
    GET  /events              Server-Sent Events: a 'hello' snapshot, then every message live
    GET  /api/poll?after=N    the messages after number N (a 'hello' snapshot first when N=0):
                              for public viewers, because Cloudflare quick tunnels buffer SSE
    GET  /api/state           the same snapshot as JSON
    GET  /api/telemetry.csv   this session's telemetry file
    GET  /images/<name>.jpg   a saved picture
    POST /api/command         {"text": "k"} -> sent up to the CanSat (ground station laptop only)

Every GET answers with  Access-Control-Allow-Origin: *  so the public dashboard on
GitHub Pages can read a live link. Commands are never accepted from other origins."""
import json
import os
import queue
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

from .bus import MessageBus, MessageLog
from .clock import Clock, ms
from .commands import CommandPolicy, CommandService
from .config import SSE_PING_S
from .state import MissionState
from .storage import SessionStorage

CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8", ".json": "application/json",
                 ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
                 ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8"}


@dataclass
class DashboardApi:
    """What the HTTP layer needs. Built once by the composition root (cli.py)."""
    state: MissionState
    bus: MessageBus
    storage: SessionStorage
    commands: CommandService
    policy: CommandPolicy
    web_root: str
    clock: Clock
    log: Optional[MessageLog] = None     # for /api/poll; filled from the bus by make_handler


def make_handler(api: DashboardApi):
    web_root = os.path.realpath(api.web_root)
    if api.log is None:
        api.log = MessageLog()
        api.bus.add_listener(api.log.append)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "DUSK1-GroundStation"

        def log_message(self, fmt, *args):
            pass

        # ------------------------------------------------------- plumbing
        def _send(self, code: int, ctype: str, body: bytes, extra: Optional[dict] = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj):
            self._send(code, "application/json", json.dumps(obj, ensure_ascii=False).encode("utf-8"))

        def _may_command(self) -> bool:
            return api.policy.may_command(self.client_address[0], self.headers)

        # ------------------------------------------------------- routes
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET")   # no cross-origin commands
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            path = url.path
            if path == "/events":
                self._events_stream()
            elif path == "/api/poll":
                self._poll(parse_qs(url.query).get("after", ["0"])[0])
            elif path == "/api/state":
                self._json(200, api.state.snapshot(ms(api.clock), self._may_command()))
            elif path == "/api/telemetry.csv":
                name = api.state.session + "_telemetry.csv"
                self._send(200, "text/csv; charset=utf-8", api.storage.telemetry_csv(),
                           {"Content-Disposition": f'attachment; filename="{name}"'})
            elif path.startswith("/images/"):
                fp = api.storage.picture_path(unquote(path[len("/images/"):]))
                if fp:
                    with open(fp, "rb") as f:
                        self._send(200, "image/jpeg", f.read())
                else:
                    self._send(404, "text/plain", b"no such picture")
            else:
                self._static(path)

        def do_POST(self):
            if urlparse(self.path).path != "/api/command":
                self._send(404, "text/plain", b"not found")
                return
            n = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(n) if n else b""
            if not self._may_command():
                self._json(403, {"ok": False, "msg": "read-only link: commands only from the ground station laptop"})
                return
            try:
                text = json.loads(body or b"{}").get("text", "")
            except (ValueError, AttributeError):
                text = ""
            ok, msg = api.commands.send(text)
            self._json(200, {"ok": ok, "msg": msg})

        # ------------------------------------------------------- helpers
        def _poll(self, after: str):
            try:
                after_n = int(after)
            except ValueError:
                after_n = 0
            msgs, seq = api.log.since(after_n) if after_n > 0 else (None, api.log.seq)
            if msgs is None:                     # first poll, or fell too far behind: start from a snapshot
                msgs = [api.state.snapshot(ms(api.clock), self._may_command())]
            self._json(200, {"seq": seq, "messages": msgs})

        def _static(self, path: str):
            rel = unquote(path).lstrip("/") or "index.html"
            if rel.endswith("/"):
                rel += "index.html"
            fp = os.path.realpath(os.path.join(web_root, rel))
            if not (fp == web_root or fp.startswith(web_root + os.sep)) or not os.path.isfile(fp):
                self._send(404, "text/plain", b"not found")
                return
            ctype = CONTENT_TYPES.get(os.path.splitext(fp)[1].lower(), "application/octet-stream")
            with open(fp, "rb") as f:
                self._send(200, ctype, f.read())

        def _events_stream(self):
            q = api.bus.subscribe()
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                hello = api.state.snapshot(ms(api.clock), self._may_command())
                self.wfile.write(("data: " + json.dumps(hello, ensure_ascii=False) + "\n\n").encode("utf-8"))
                self.wfile.flush()
                while True:
                    try:
                        data = q.get(timeout=SSE_PING_S)
                        self.wfile.write(("data: " + data + "\n\n").encode("utf-8"))
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                api.bus.unsubscribe(q)
                self.close_connection = True

    return Handler


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, api: DashboardApi):
        super().__init__(address, make_handler(api))

    def handle_error(self, request, client_address):
        pass                                 # a browser closing its tab is not an error
