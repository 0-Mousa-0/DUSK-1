import unittest

from dusk1_ground.commands import CommandPolicy, CommandService
from dusk1_ground.link import LinkMonitor, link_state

from helpers import Rig, telemetry_line


class LinkStateTest(unittest.TestCase):
    def test_states(self):
        self.assertEqual(link_state(False, 0, 100), "CONNECTING")
        self.assertEqual(link_state(True, 0, 100), "WAITING")
        self.assertEqual(link_state(True, 98, 100), "LIVE")
        self.assertEqual(link_state(True, 90, 100), "NO DATA")

    def test_monitor_reports_changes_and_publishes_counters(self):
        rig = Rig()

        class FakeSource:
            connected, label = True, "fake"
        monitor = LinkMonitor(rig.state, FakeSource(), rig.bus, rig.events, rig.clock)
        self.assertEqual(monitor.tick(), "WAITING")
        rig.feed(telemetry_line(1))
        self.assertEqual(monitor.tick(), "LIVE")
        rig.clock.advance(10)
        self.assertEqual(monitor.tick(), "NO DATA")
        self.assertEqual([t for t in rig.event_texts() if t.startswith("Link")], ["Link: LIVE", "Link: NO DATA"])
        self.assertTrue(rig.of_type("stats"))


class CommandPolicyTest(unittest.TestCase):
    def test_only_the_ground_station_laptop_may_command(self):
        p = CommandPolicy()
        self.assertTrue(p.may_command("127.0.0.1", {}))
        self.assertTrue(p.may_command("::1", {"Host": "localhost"}))
        self.assertFalse(p.may_command("192.168.4.2", {}))
        # a Cloudflare tunnel connects from 127.0.0.1 but adds its headers
        self.assertFalse(p.may_command("127.0.0.1", {"Cf-Connecting-Ip": "203.0.113.9"}))
        self.assertFalse(p.may_command("127.0.0.1", {"X-Forwarded-For": "203.0.113.9"}))

    def test_lan_commands_are_opt_in(self):
        p = CommandPolicy(allow_lan=True)
        self.assertTrue(p.may_command("192.168.4.2", {}))
        self.assertFalse(p.may_command("8.8.8.8", {}))         # a public address, not the LAN
        self.assertFalse(p.may_command("192.168.4.2", {"Cf-Connecting-Ip": "203.0.113.9"}))


class CommandServiceTest(unittest.TestCase):
    def setUp(self):
        self.rig = Rig()
        self.sent = []
        rig = self

        class FakeSource:
            def write(self, data):
                rig.sent.append(data)
                return True
        self.service = CommandService(lambda: FakeSource(), self.rig.events)

    def test_sends_one_line(self):
        self.assertEqual(self.service.send("  k "), (True, "sent"))
        self.assertEqual(self.sent, [b"k\n"])
        self.assertIn("Sent: k", self.rig.event_texts())

    def test_rejects_empty_and_multi_line(self):
        self.assertFalse(self.service.send("")[0])
        self.assertFalse(self.service.send("k\nz")[0])
        self.assertFalse(self.service.send("x" * 200)[0])
        self.assertEqual(self.sent, [])

    def test_no_source(self):
        service = CommandService(lambda: None, self.rig.events)
        self.assertEqual(service.send("k"), (False, "no connection to the ground OBC / radio"))


if __name__ == "__main__":
    unittest.main()
