import unittest

from dusk1_ground import protocol
from dusk1_ground.protocol import ConsoleLine, GroundLine, PictureChunk, SatelliteLine

from helpers import chunk_line, telemetry_line


class ParseLineTest(unittest.TestCase):
    def test_telemetry_is_a_satellite_line(self):
        rec = protocol.parse_line(telemetry_line(7))
        self.assertIsInstance(rec, SatelliteLine)
        self.assertEqual(rec.sat_time, "2026-10-20 19:37:32")
        self.assertTrue(protocol.is_telemetry(rec.body))

    def test_fields_keep_the_pipe_in_the_magnitude_name(self):
        rec = protocol.parse_line(telemetry_line(7))
        fields = protocol.parse_fields(rec.body)
        self.assertEqual(fields["|a|"], "10.09")
        self.assertEqual(fields["pkt"], "7")
        self.assertEqual(fields["err"], "0")

    def test_ground_line(self):
        rec = protocol.parse_line("DUSK1-GS:> status | up 4 | laptops 1")
        self.assertEqual(rec, GroundLine("status | up 4 | laptops 1"))
        self.assertEqual(protocol.parse_pairs(rec.body), {"up": "4", "laptops": "1"})

    def test_picture_chunk_checksum(self):
        good = protocol.parse_line(chunk_line(3, 5, "QUJD"))
        bad = protocol.parse_line(chunk_line(3, 5, "QUJD", corrupt=True))
        self.assertIsInstance(good, PictureChunk)
        self.assertTrue(good.valid)
        self.assertEqual(good.data(), b"ABC")
        self.assertFalse(bad.valid)

    def test_picture_header_and_end(self):
        h = protocol.parse_picture_header("img 38 start | 320x240 | 6263 bytes | 33 chunks")
        self.assertEqual((h.image_id, h.width, h.height, h.size, h.chunks), (38, 320, 240, 6263, 33))
        self.assertTrue(protocol.is_picture_end("img 38 end | 33 chunks | 4.8 s"))
        self.assertIsNone(protocol.parse_picture_header("img 38 end"))

    def test_other_text_is_console(self):
        self.assertIsInstance(protocol.parse_line("[1/6] I2C scan on SDA=IO14, SCL=IO15"), ConsoleLine)

    def test_boot_noise_is_not_clean(self):
        self.assertFalse(protocol.is_clean("øxf~æ ZHZ"))
        self.assertFalse(protocol.is_clean("abc�"))
        self.assertTrue(protocol.is_clean("gravity corr.    1.000 g = 9.807 m/s²   PASS"))


if __name__ == "__main__":
    unittest.main()
