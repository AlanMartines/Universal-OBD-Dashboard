"""Testes da análise do Roteiro de captura do app, com um arquivo de diagnóstico sintético."""
import gzip
import io
import json
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roteiro_app as ra  # noqa: E402


def frame(fid, data):
    return f"t{fid:03X}{len(data)}" + "".join(f"{b:02X}" for b in data)


class Builder:
    def __init__(self):
        self.lines, self.t = [], 1_000_000

    def mark(self, step, phase, **kw):
        self.lines.append(dict(t=self.t, type="mark", script="generic", step=step, phase=phase, **kw))

    def frames(self, seconds, door_open, rpm_byte=0x10):
        rnd = random.Random(self.t)
        for _ in range(int(seconds * 10)):
            self.t += 100
            # 0x3C0 b2 bit 5 = porta aberta; b4 = ruído
            self.lines.append(dict(t=self.t, type="esp32", l=frame(0x3C0, [0, 0, 0x20 if door_open else 0, 0, rnd.randrange(256)])))
            self.lines.append(dict(t=self.t, type="esp32", l=frame(0x281, [3, 1, 0x80, 0x79, rpm_byte, 0, 0, 4])))

    def write(self):
        fd, path = tempfile.mkstemp(suffix=".jsonl.gz")
        os.close(fd)
        with gzip.open(path, "wt") as fh:
            for line in self.lines:
                fh.write(json.dumps(line) + "\n")
        return path


class RoteiroAppTest(unittest.TestCase):
    def test_pattern_finds_the_bit_that_follows_the_action(self):
        b = Builder()
        b.frames(3, False)
        b.mark("door_driver", "step_start", label="Porta do motorista")
        for n in (1, 2, 3):
            b.mark("door_driver", "on", n=n)
            b.frames(10, True)
            b.mark("door_driver", "off", n=n)
            b.frames(10, False)
        b.mark("door_driver", "step_end", result="done")
        path = b.write()
        frames, marks = ra.load(path)
        runs, _ = ra.steps_from_marks(marks)
        found = ra.analyze_pattern(runs[0], frames)
        self.assertEqual([((0x3C0, 2, 5), 1)], [(k, v) for k, v, _, _ in found])
        out = io.StringIO()
        ra.report(path, out=out)
        self.assertIn("0x3C0 b2 bit 5 = 1 com a ação", out.getvalue())
        os.remove(path)

    def test_phases_show_bytes_that_change_and_events_show_flips(self):
        b = Builder()
        b.mark("rpm_fixed", "step_start", label="Rotações fixas")
        b.mark("rpm_fixed", "phase", n=1, label="Marcha lenta")
        b.frames(10, False, rpm_byte=0x07)
        b.mark("rpm_fixed", "phase", n=2, label="Segure dois mil")
        b.frames(10, False, rpm_byte=0x10)
        b.mark("rpm_fixed", "choice", label="Indicador de economia", value="Vermelho")
        b.mark("rpm_fixed", "step_end", result="done")
        b.mark("radiator_fan", "step_start", label="Eletroventilador")
        b.frames(6, False)
        b.mark("radiator_fan", "event", label="Ventilador ligou", value="97 °C")
        b.frames(6, True)
        b.mark("radiator_fan", "step_end", result="done")
        b.mark("hood", "skip")
        path = b.write()
        out = io.StringIO()
        ra.report(path, out=out)
        text = out.getvalue()
        self.assertIn("0x281 b4", text)
        self.assertIn("escolha: Indicador de economia = Vermelho", text)
        self.assertIn("Ventilador ligou 97 °C: 0x3C0 b2 bit 5", text)
        self.assertIn("hood: pulado", text)
        os.remove(path)

    def test_frame_parser(self):
        self.assertEqual((0x2A0, bytes([3, 0x80])), ra.parse_frame("t2A020380"))
        self.assertEqual((0x18DAF110, bytes([0xAA])), ra.parse_frame("T18DAF1101AA"))
        self.assertIsNone(ra.parse_frame("# stats"))
        self.assertIsNone(ra.parse_frame("t2A0403"))


if __name__ == "__main__":
    unittest.main()
