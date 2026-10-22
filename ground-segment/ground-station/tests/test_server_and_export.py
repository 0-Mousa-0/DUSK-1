import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from dusk1_ground.commands import CommandPolicy, CommandService
from dusk1_ground.replay_export import export_replay
from dusk1_ground.server import DashboardApi, DashboardServer

from helpers import Rig, telemetry_line

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(HERE, "..", "sample_data", "sample_raw.log")


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rig = Rig()
        cls.rig.feed(telemetry_line(1))
        cls.web = tempfile.mkdtemp()
        with open(os.path.join(cls.web, "index.html"), "w") as f:
            f.write("<!doctype html><title>t</title>")
        cls.sent = []
        sent = cls.sent

        class FakeSource:
            def write(self, data):
                sent.append(data)
                return True
        api = DashboardApi(cls.rig.state, cls.rig.bus, cls.rig.storage,
                           CommandService(lambda: FakeSource(), cls.rig.events), CommandPolicy(), cls.web, cls.rig.clock)
        cls.server = DashboardServer(("127.0.0.1", 0), api)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def get(self, path, headers=None):
        return urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers or {}), timeout=5)

    def post_command(self, text, headers=None):
        req = urllib.request.Request(self.base + "/api/command", data=json.dumps({"text": text}).encode(),
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            r = urllib.request.urlopen(req, timeout=5)
            return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_state_snapshot_with_cors(self):
        r = self.get("/api/state")
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], "*")
        snap = json.load(r)
        self.assertEqual(snap["type"], "hello")
        self.assertEqual(snap["history"][0]["pkt"], 1)
        self.assertTrue(snap["can_command"])           # this test runs on the laptop itself

    def test_public_viewer_is_read_only(self):
        snap = json.load(self.get("/api/state", {"Cf-Connecting-Ip": "203.0.113.9"}))
        self.assertFalse(snap["can_command"])
        code, body = self.post_command("k", {"Cf-Connecting-Ip": "203.0.113.9"})
        self.assertEqual(code, 403)
        self.assertFalse(body["ok"])
        self.assertNotIn(b"k\n", self.sent)

    def test_poll_gives_a_snapshot_then_new_messages(self):
        self.rig.events.info("SYSTEM", "something already happened")   # the log is never empty in a real run
        first = json.load(self.get("/api/poll?after=0"))
        self.assertEqual(first["messages"][0]["type"], "hello")
        self.rig.feed(telemetry_line(2))
        nxt = json.load(self.get(f"/api/poll?after={first['seq']}"))
        self.assertIn(2, [m.get("pkt") for m in nxt["messages"] if m["type"] == "telemetry"])
        self.assertGreater(nxt["seq"], first["seq"])
        again = json.load(self.get(f"/api/poll?after={nxt['seq']}"))
        self.assertEqual(again["messages"], [])
        # a seq the server never gave (backend restarted) -> a fresh snapshot
        self.assertEqual(json.load(self.get("/api/poll?after=999999"))["messages"][0]["type"], "hello")

    def test_local_command_is_sent(self):
        code, body = self.post_command("v")
        self.assertEqual((code, body["ok"]), (200, True))
        self.assertIn(b"v\n", self.sent)

    def test_static_files_and_no_path_escape(self):
        self.assertIn(b"<title>t</title>", self.get("/").read())
        for evil in ("/../dusk1_ground/cli.py", "/%2e%2e/%2e%2e/secret", "/..%5c..%5cwin.ini"):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.get(evil)
            self.assertEqual(cm.exception.code, 404)


class ExportTest(unittest.TestCase):
    def test_sample_session_exports_a_playable_replay(self):
        out = tempfile.mkdtemp()
        meta = export_replay(SAMPLE, out, "sample")
        self.assertGreater(meta["telemetry"], 50)
        with open(os.path.join(out, "replay.json"), encoding="utf-8") as f:
            data = json.load(f)
        times = [t for t, _ in data["messages"]]
        self.assertEqual(times, sorted(times))         # in playing order
        images = [m for _, m in data["messages"] if m["type"] == "image"]
        self.assertTrue(images)
        for img in images:
            self.assertTrue(img["url"].startswith("images/"))
            self.assertTrue(os.path.isfile(os.path.join(out, img["url"])))


if __name__ == "__main__":
    unittest.main()
