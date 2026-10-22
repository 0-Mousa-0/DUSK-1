import subprocess
import unittest

from dusk1_ground.announce import PagesAnnouncer
from dusk1_ground.sharing import CloudflareTunnel

from helpers import Rig

LINK = "https://some-words.trycloudflare.com"


class FakeGh:
    def __init__(self, fail_on=None):
        self.calls, self.fail_on = [], fail_on

    def __call__(self, cmd, **kw):
        self.calls.append(cmd[1:3])
        failed = self.fail_on == cmd[1]
        return subprocess.CompletedProcess(cmd, 1 if failed else 0, "", "HTTP 403: Resource not accessible" if failed else "")


class PagesAnnouncerTest(unittest.TestCase):
    def announcer(self, rig, gh, answers):
        answers = iter(answers)

        def read_live(url):
            a = next(answers)
            if isinstance(a, Exception):
                raise a
            return a
        return PagesAnnouncer(rig.events, "https://example.github.io/DUSK-1/", "team/DUSK-1", gh="gh", run=gh,
                              read_live=read_live, sleep=lambda s: None, poll_s=10, timeout_s=40)

    def test_sets_the_variable_redeploys_and_waits_for_the_site(self):
        rig, gh = Rig(), FakeGh()
        ok = self.announcer(rig, gh, [OSError("404"), "https://old.trycloudflare.com", LINK]).announce(LINK)
        self.assertTrue(ok)
        self.assertEqual(gh.calls, [["variable", "set"], ["workflow", "run"]])
        self.assertEqual(rig.event_texts()[-1], "Public dashboard is live: https://example.github.io/DUSK-1/")

    def test_a_refused_step_is_reported_and_stops(self):
        rig, gh = Rig(), FakeGh(fail_on="variable")
        self.assertFalse(self.announcer(rig, gh, []).announce(LINK))
        self.assertEqual(gh.calls, [["variable", "set"]])
        self.assertIn("HTTP 403", rig.event_texts()[-1])

    def test_gives_up_after_the_timeout(self):
        rig = Rig()
        self.assertFalse(self.announcer(rig, FakeGh(), [None] * 4).announce(LINK))
        self.assertIn("?live= link works meanwhile", rig.event_texts()[-1])


class TunnelListenerTest(unittest.TestCase):
    def test_listeners_hear_the_address_once(self):
        rig, heard = Rig(), []
        tunnel = CloudflareTunnel(8080, rig.events, "https://example.github.io/DUSK-1/", [heard.append])

        class FakeProc:
            stdout = iter(["starting\n", f"|  {LINK}  |\n", f"again {LINK}\n"])
            def poll(self): return None
        tunnel._proc = FakeProc()
        tunnel._watch()
        self.assertEqual(heard, [LINK])
        self.assertIn(f"Public dashboard: https://example.github.io/DUSK-1/?live={LINK}", rig.event_texts())


if __name__ == "__main__":
    unittest.main()
