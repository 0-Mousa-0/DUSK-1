"""Constants shared by the ground station. Change a number here, not in the code."""

# Telemetry fields in the order the CanSat sends them (see the space segment README).
TELEMETRY_FIELDS = ("pkt", "T", "RH", "ax", "ay", "az", "|a|", "gx", "gy", "gz", "roll", "pitch", "n", "err")
INTEGER_FIELDS = frozenset({"pkt", "n", "err"})
JSON_KEY = {"|a|": "a"}               # "|a|" is not a friendly JSON key

CHUNK_RAW_BYTES = 192                 # JPEG bytes per picture piece (CanSat IMG_CHUNK_RAW)
STALE_AFTER_S = 5.0                   # no telemetry for 5 s = NO DATA

HISTORY_LIMIT = 3600                  # telemetry rows kept in memory (1 hour)
EVENTS_LIMIT = 400
SNAPSHOT_HISTORY = 900                # rows sent to a dashboard when it connects
SNAPSHOT_EVENTS = 300
SUBSCRIBER_QUEUE = 2000               # messages waiting per dashboard before dropping

DEFAULT_TCP = "192.168.4.1:5760"      # Ground OBC access point
DEFAULT_HTTP_HOST = "127.0.0.1"
DEFAULT_HTTP_PORT = 8080
SSE_PING_S = 15

COMMAND_MAX_LEN = 120
RETRY_S = 3

# Replay pacing: how long each kind of line took on the real link.
REPLAY_DELAY_S = {"telemetry": 1.0, "chunk": 0.14, "other": 0.01}

PUBLIC_DASHBOARD_URL = "https://0-mousa-0.github.io/DUSK-1/"
TUNNEL_RETRY_S = 10                   # a closed public link reopens after 10 s, backing off to 5 min
TUNNEL_RETRY_MAX_S = 300

# --share also points the public dashboard at the live link (announce.py, through the GitHub CLI)
PAGES_REPO = "0-Mousa-0/DUSK-1"
PAGES_BRANCH = "ground-segment"
PAGES_WORKFLOW = "pages.yml"
PAGES_LIVE_VARIABLE = "LIVE_URL"      # Actions variable the Pages build writes to live.json
PAGES_UPDATE_TIMEOUT_S = 300
