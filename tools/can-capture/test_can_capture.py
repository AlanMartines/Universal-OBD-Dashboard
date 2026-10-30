"""Testes da ferramenta de escuta CAN, com quadros fictícios."""
import io
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import can_capture as cc  # noqa: E402


CAPTURE = """\
1000 # arduino-can-listen 1.0
1001 # listen-only 50 kbps
1100 t2808000000000A000000
1150 T0A1B2C3D211FF
1200 t2808000000000A000000
1300 t3A0400112233
1600 # MARCA seta esquerda
1700 t2808000000000A000020
1800 t3A0400112233
1900 t2808000000000A000020
2000 t5F1200FF
2050 r1230
"""


class ParseTest(unittest.TestCase):

    def test_standard_extended_and_remote_frames(self):
        f = cc.parse_slcan("t1238AABBCCDDEEFF0011", 5)
        self.assertEqual((0x123, False, False, 5), (f.can_id, f.extended, f.rtr, f.t_ms))
        self.assertEqual(bytes.fromhex("AABBCCDDEEFF0011"), f.data)
        e = cc.parse_slcan("T1ABCDEF020102")
        self.assertEqual(("1ABCDEF0", b"\x01\x02"), (e.key, e.data))
        r = cc.parse_slcan("r1230")
        self.assertTrue(r.rtr)
        self.assertEqual(b"", r.data)
        self.assertEqual(b"\xaa", cc.parse_slcan("t1231AAEA5F").data)     # com o carimbo de tempo do slcan

    def test_rejects_malformed_lines(self):
        for bad in ["", "# estado", "x123", "t12", "t1239", "t1232AA", "t8001FF", "tZZZ0", "T200000000100",
                    "t1231AAB", "t1231AA12345"]:
            self.assertIsNone(cc.parse_slcan(bad), bad)

    def test_timestamps_marks_and_status(self):
        cap = cc.parse_lines(CAPTURE.splitlines())
        self.assertEqual(9, len(cap.frames))
        self.assertEqual([cc.Mark(1600, "seta esquerda")], cap.marks)
        self.assertIn((1001, "listen-only 50 kbps"), cap.status)
        self.assertEqual(1100, cap.frames[0].t_ms)

    def test_plain_slcan_without_timestamps(self):
        cap = cc.parse_lines(["t1231AA", "t1231AB"])
        self.assertEqual([0, 1], [f.t_ms for f in cap.frames])


class SerialLinesTest(unittest.TestCase):

    def test_only_valid_frames_are_counted(self):
        fh = io.StringIO()
        rest, frames, status = cc.write_serial_lines(b"", b"ada a 500 kbps\n# stats\nt1231AA\nt12", fh, 7)
        self.assertEqual((b"t12", 1, ["# stats"]), (rest, frames, status))
        self.assertIn("7 ada a 500 kbps", fh.getvalue())         # o que não é quadro continua gravado


class AnalysisTest(unittest.TestCase):

    def setUp(self):
        self.cap = cc.parse_lines(CAPTURE.splitlines())

    def test_summary_per_id(self):
        s = cc.summarize(self.cap.frames)
        self.assertEqual(4, s["280"]["count"])
        self.assertAlmostEqual(3.75, s["280"]["hz"], places=2)     # 3 intervalos em 0,8 s
        self.assertEqual([0x00, 0x20], s["280"]["values"][7])
        self.assertEqual([0x0A], s["280"]["values"][4])
        self.assertIsNone(s["5F1"]["hz"])                          # um quadro só
        self.assertEqual([0], s["123"]["lengths"])                 # pedido remoto

    def test_compare_before_and_after(self):
        before = [f for f in self.cap.frames if f.t_ms < 1600]
        after = [f for f in self.cap.frames if f.t_ms >= 1600]
        new_ids, gone_ids, changed = cc.compare(before, after)
        self.assertEqual(["123", "5F1"], new_ids)
        self.assertEqual(["0A1B2C3D"], gone_ids)
        self.assertEqual([("280", 7, [0x00], [0x20])], changed)

    def test_window_around_marks(self):
        [(mark, (new_ids, _, changed))] = cc.around_marks(self.cap, window_s=0.3)
        self.assertEqual("seta esquerda", mark.label)
        self.assertEqual(["280"], new_ids)                         # nenhum 280 nos 0,3 s antes; 5F1 chega depois
        self.assertEqual([], changed)
        [(_, (_, _, changed))] = cc.around_marks(self.cap, window_s=1.0)
        self.assertEqual([("280", 7, [0x00], [0x20])], changed)

    def test_commands_print_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "cap.log")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(CAPTURE)
            out = io.StringIO()
            cc.cmd_resumo(SimpleNamespace(arquivo=path), out)
            self.assertIn("# listen-only 50 kbps", out.getvalue())
            self.assertIn("b7:2", out.getvalue())
            out = io.StringIO()
            cc.cmd_marcas(SimpleNamespace(arquivo=path, janela=1.0), out)
            self.assertIn("280 byte 7: 00  →  20", out.getvalue())
            out = io.StringIO()
            cc.cmd_comparar(SimpleNamespace(antes=path, depois=path), out)
            self.assertIn("nenhuma diferença", out.getvalue())


class ReadingsTest(unittest.TestCase):

    LOG = [
        "1000 # MARCA seta: desligada inicio", "1100 t2801" "00", "2000 # MARCA seta: desligada fim",
        "2500 # MARCA refazer Seta", "3000 # MARCA seta: desligada inicio", "3100 t2801" "00",
        "4000 # MARCA seta: desligada fim", "4500 t2801" "01", "5000 # MARCA seta: ligada inicio",
        "6000 # MARCA seta: ligada fim", "7000 # MARCA porta: fechada inicio", "7100 t3001" "AA",
        "8000 # MARCA porta: fechada fim",
    ]

    def test_compares_consecutive_readings_of_each_test(self):
        cap = cc.parse_lines(self.LOG)
        [(test, state_a, state_b, (new, gone, changed))] = cc.around_readings(cap)
        self.assertEqual(("seta", "desligada", "ligada"), (test, state_a, state_b))
        self.assertEqual(([], []), (new, gone))
        self.assertEqual([("280", 0, [0x00], [0x01])], changed)              # quadro avulso antes do Enter conta

    def test_redone_readings_are_dropped(self):
        reads = cc.readings(cc.parse_lines(self.LOG))
        self.assertEqual(3000, reads[0][2])
        self.assertEqual(3, len(reads))


if __name__ == "__main__":
    unittest.main()
