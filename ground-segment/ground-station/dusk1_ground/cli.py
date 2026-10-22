"""Composition root: reads the command line and wires the parts together.

    python -m dusk1_ground                               Wi-Fi, Ground OBC at 192.168.4.1:5760
    python -m dusk1_ground --serial COM5                 UNO R4 WiFi on USB (115200)
    python -m dusk1_ground --serial COM7 --baud 57600    ground radio straight on USB
    python -m dusk1_ground --replay raw.log --loop       play back a saved session
    python -m dusk1_ground ... --share                   + public read-only live link
    python -m dusk1_ground --replay raw.log --export-replay web/replay
    add  --host 0.0.0.0  so other laptops on the same network can open http://<this-laptop-ip>:8080
"""
import argparse
import datetime as dt
import os
import sys

from .bus import MessageBus
from .clock import SystemClock
from .commands import CommandPolicy, CommandService
from .config import DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, DEFAULT_TCP, PUBLIC_DASHBOARD_URL
from .decoder import DecoderContext, build_decoder
from .events import EventReporter, console_printer
from .link import LinkMonitor
from .server import DashboardApi, DashboardServer
from .sharing import CloudflareTunnel
from .sources import ReplaySource, SerialSource, TcpSource
from .state import MissionState
from .storage import FileSessionStorage

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # ground-station/


def parse_args(argv=None):
    ap = argparse.ArgumentParser(prog="dusk1_ground", description="DUSK-1 ground station backend")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--tcp", default=DEFAULT_TCP, help="Ground OBC over Wi-Fi (default %(default)s)")
    src.add_argument("--serial", help="USB port, e.g. COM5")
    src.add_argument("--replay", help="play back a saved raw.log")
    ap.add_argument("--baud", type=int, default=115200, help="115200 for the UNO R4 WiFi, 57600 for the radio")
    ap.add_argument("--speed", type=float, default=1.0, help="replay speed")
    ap.add_argument("--loop", action="store_true", help="replay forever")
    ap.add_argument("--host", default=DEFAULT_HTTP_HOST, help="0.0.0.0 lets other laptops open the dashboard")
    ap.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT)
    ap.add_argument("--data", default=os.path.join(HERE, "dusk1_data"), help="where sessions are saved")
    ap.add_argument("--web", default=os.path.join(HERE, "web"), help="the dashboard files")
    ap.add_argument("--share", action="store_true", help="open a public read-only live link (needs cloudflared)")
    ap.add_argument("--lan-commands", action="store_true", help="with --host 0.0.0.0: laptops on the same private "
                                                                "network may send commands too (default: only this laptop)")
    ap.add_argument("--pages-url", default=PUBLIC_DASHBOARD_URL, help="public dashboard used in the shared link")
    ap.add_argument("--export-replay", metavar="OUT_DIR", help="with --replay: write a replay for the public "
                                                               "dashboard and exit")
    ap.add_argument("--title", help="with --export-replay: name shown in the dashboard")
    return ap.parse_args(argv)


def make_source(args, sink, events):
    if args.serial:
        return SerialSource(args.serial, args.baud, sink, events)
    if args.replay:
        return ReplaySource(args.replay, args.speed, args.loop, sink, events)
    host, _, port = args.tcp.partition(":")
    return TcpSource(host, int(port or 5760), sink, events)


def run_export(args) -> None:
    from .replay_export import export_replay
    if not args.replay:
        sys.exit("--export-replay needs --replay <raw.log>")
    meta = export_replay(args.replay, args.export_replay, args.title)
    print(f"Replay written to {args.export_replay}: {meta['telemetry']} telemetry lines, {meta['lost']} lost, "
          f"{meta['pictures_ok']} complete + {meta['pictures_partial']} partial pictures, {meta['duration_s']} s")


def main(argv=None) -> None:
    args = parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    if args.export_replay:
        run_export(args)
        return

    clock = SystemClock()
    storage = FileSessionStorage(args.data, dt.datetime.now())
    state = MissionState(storage.name)
    bus = MessageBus()
    events = EventReporter(state, bus, clock, sinks=[storage.write_event, console_printer])
    decoder = build_decoder(DecoderContext(state, bus, events, storage, clock))
    source = make_source(args, decoder.feed, events)
    api = DashboardApi(state, bus, storage, CommandService(lambda: source, events),
                       CommandPolicy(allow_lan=args.lan_commands), args.web, clock)
    server = DashboardServer((args.host, args.port), api)

    print(f"DUSK-1 ground station · dashboard: http://localhost:{args.port} · data: {storage.path}", flush=True)
    events.info("SYSTEM", f"Backend started, source: {source.label}")
    source.start()
    LinkMonitor(state, source, bus, events, clock).start()
    tunnel = CloudflareTunnel(args.port, events, args.pages_url) if args.share else None
    if tunnel:
        tunnel.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        source.stop()
        if tunnel:
            tunnel.stop()
        decoder.close()
        storage.close()
        c = state.stats()
        print(f"\nSaved in {storage.path}: {c['telemetry']} telemetry lines, {c['lost']} lost, "
              f"{c['pictures_ok']} complete pictures, {c['pictures_partial']} partial.")
