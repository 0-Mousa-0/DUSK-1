import base64
import unittest

from helpers import Rig, chunk_line, telemetry_line


def b64_pieces(blob: bytes, size: int = 192):
    return [base64.b64encode(blob[i:i + size]).decode() for i in range(0, len(blob), size)]


class TelemetryTest(unittest.TestCase):
    def test_values_are_typed_and_saved(self):
        rig = Rig()
        rig.feed(telemetry_line(1))
        (msg,) = rig.of_type("telemetry")
        self.assertEqual(msg["pkt"], 1)
        self.assertIsInstance(msg["pkt"], int)
        self.assertAlmostEqual(msg["a"], 10.09)
        self.assertAlmostEqual(msg["T"], 23.5)
        self.assertEqual(rig.storage.rows[0][:3], ["2026-10-20 19:37:32", "1", "23.5"])
        self.assertEqual(rig.state.counters["telemetry"], 1)

    def test_gap_in_packet_numbers_counts_lost_lines(self):
        rig = Rig()
        rig.feed(telemetry_line(1), telemetry_line(2), telemetry_line(6))
        self.assertEqual(rig.state.counters["lost"], 3)
        self.assertIn("Lost 3 line(s) before pkt 6", rig.event_texts())

    def test_missing_dht_value_becomes_none(self):
        rig = Rig()
        rig.feed(telemetry_line(1, temp="--"))
        self.assertIsNone(rig.of_type("telemetry")[0]["T"])

    def test_boot_resets_the_packet_counter(self):
        rig = Rig()
        rig.feed(telemetry_line(40),
                 "Dusk1-2026-10-20 19:40:00:> boot | reset power-on | mpu ok | dht ok | cam ok | gravity x",
                 telemetry_line(1))
        self.assertEqual(rig.state.counters["lost"], 0)
        self.assertEqual(rig.state.boot["fields"]["reset"], "power-on")


class NoiseTest(unittest.TestCase):
    def test_boot_noise_is_hidden_until_a_protocol_line(self):
        rig = Rig()
        rig.feed("øxf~æ ZHZ", "ets Jun  8 2016 00:22:57", telemetry_line(1))
        self.assertEqual(rig.state.counters["noise"], 2)
        self.assertEqual(len(rig.of_type("telemetry")), 1)
        self.assertIn("CanSat restarted (its boot text is hidden)", rig.event_texts())


class PictureTest(unittest.TestCase):
    JPEG = bytes(range(256)) * 3                # 768 bytes = 4 pieces of 192

    def _send(self, rig, skip=(), corrupt=()):
        pieces = b64_pieces(self.JPEG)
        rig.feed(f"Dusk1-2026-10-20 19:37:34:> img 1 start | 320x240 | {len(self.JPEG)} bytes | {len(pieces)} chunks")
        for i, p in enumerate(pieces):
            if i not in skip:
                rig.feed(chunk_line(1, i, p, corrupt=i in corrupt))
        rig.feed("Dusk1-2026-10-20 19:37:38:> img 1 end | 4 chunks | 4.0 s")

    def test_complete_picture_is_rebuilt_exactly(self):
        rig = Rig()
        self._send(rig)
        (img,) = rig.of_type("image")
        self.assertTrue(img["complete"])
        self.assertEqual(img["url"], "/images/img_0001_20261020_193734.jpg")
        self.assertEqual(rig.storage.pictures[img["name"]], self.JPEG)
        self.assertEqual(rig.state.counters["pictures_ok"], 1)

    def test_missing_and_damaged_pieces_give_a_partial_picture(self):
        rig = Rig()
        self._send(rig, skip={1}, corrupt={2})
        (img,) = rig.of_type("image")
        self.assertFalse(img["complete"])
        self.assertEqual(img["missing"], 2)
        self.assertTrue(img["name"].endswith("_PARTIAL.jpg"))
        blob = rig.storage.pictures[img["name"]]
        self.assertEqual(len(blob), len(self.JPEG))
        self.assertEqual(blob[192:384], b"\x00" * 192)    # the lost piece is a grey band
        self.assertEqual(rig.state.counters["bad_pieces"], 1)

    def test_picture_without_end_line_is_saved_at_close(self):
        rig = Rig()
        rig.feed("Dusk1-2026-10-20 19:37:34:> img 9 start | 320x240 | 100 bytes | 1 chunks")
        rig.decoder.close()
        self.assertEqual(len(rig.of_type("image")), 1)


class GroundObcTest(unittest.TestCase):
    def test_status_and_uplink(self):
        rig = Rig()
        rig.feed("DUSK1-GS:> status | up 125 | laptops 2 | lines 10",
                 "DUSK1-GS:> uplink | k | from USB")
        self.assertEqual(rig.state.gs["fields"]["laptops"], "2")
        self.assertIn("Ground OBC sent up: k | from USB", rig.event_texts())


class ConsoleTest(unittest.TestCase):
    def test_start_up_checks_reach_the_console(self):
        rig = Rig()
        rig.feed("[1/6] I2C scan on SDA=IO14, SCL=IO15")
        self.assertEqual(rig.of_type("console")[0]["text"], "[1/6] I2C scan on SDA=IO14, SCL=IO15")


if __name__ == "__main__":
    unittest.main()
