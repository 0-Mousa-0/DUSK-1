"""DUSK-1 ground station backend - Team Dusk · CanSat 2026.

    CanSat --915 MHz--> ground radio --> Ground OBC (UNO R4 WiFi) --Wi-Fi / USB--> this package --> dashboard

The package is split by responsibility (one reason to change per module):

    protocol      the DUSK-1 line protocol: pure parsing, no I/O
    messages      the JSON messages pushed to dashboards
    clock         time source (real or virtual, for replays and tests)
    bus           publish / subscribe between the backend and every open dashboard
    state         what the dashboards see: history, pictures, events, counters
    events        mission events: one place that records, saves and prints them
    storage       the session folder: telemetry.csv, images/, raw.log, events.log
    pictures      rebuilds JPEG pictures from radio pieces
    decoder       turns raw lines into state changes, through small line handlers
    sources       where lines come from: Wi-Fi (TCP), USB serial, or a saved raw.log
    link          LIVE / WAITING / NO DATA link monitor
    commands      who may send commands up to the CanSat, and how
    server        HTTP + Server-Sent Events API, serves the web dashboard
    sharing       public read-only link through a Cloudflare tunnel
    replay_export turns a raw.log into a replay for the public dashboard
    cli           composition root: reads the command line and wires everything
"""

__version__ = "2.0.0"
