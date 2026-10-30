"""Testes do roteiro guiado, sem porta USB: gravador e relógio fictícios."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roteiro as rt  # noqa: E402


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


class FakeRecorder:
    """Grava as marcas num arquivo de verdade, no formato do can_capture, sem abrir porta."""
    instances = []

    def __init__(self, port, path, baud=500000, show=print):
        self.path, self.frames, self.marks = path, 10, []
        FakeRecorder.instances.append(self)

    def start(self):
        open(self.path, "a").close()
        return self

    def silent_for(self):
        return 0.0

    def mark(self, label):
        self.marks.append(label)

    def stop(self):
        return self.frames


def session(folder, answers, clock, step_s=5.0):
    """Cada resposta avança [step_s] no relógio, como alguém esperando entre as ações."""
    answers = iter(answers)

    def ask(_prompt):
        clock.t += step_s
        return next(answers)

    FakeRecorder.instances = []
    s = rt.Session(os.path.join(folder, "porta"), folder, ask=ask, out=lambda *_: None,
                   sleep=clock.sleep, recorder=FakeRecorder)
    open(s.port, "w").close()                                    # porta "existe" e pode ser lida
    return s


def notes(s):
    with open(s.notes_path, encoding="utf-8") as fh:
        return fh.read()


class VoltageTest(unittest.TestCase):

    def test_classification(self):
        self.assertIn("tolerante a falhas (ISO", rt.classify_voltages(0.2, 4.8))
        self.assertIn("tolerante a falhas dormindo", rt.classify_voltages(0.0, 11.3))   # ignição desligada
        self.assertIn("invertido", rt.classify_voltages(4.7, 0.4))
        self.assertIn("invertido", rt.classify_voltages(12.1, 0.0))
        self.assertIn("alta velocidade", rt.classify_voltages(2.5, 2.4))
        self.assertIn("dormindo ou fio sem ligação", rt.classify_voltages(0.0, 0.1))
        self.assertIn("fora do esperado", rt.classify_voltages(0.0, 2.5))

    def test_parse_accepts_comma(self):
        self.assertEqual(4.8, rt.parse_volts("4,8"))
        self.assertEqual(0.35, rt.parse_volts(" 0.35 "))
        self.assertIsNone(rt.parse_volts("abc"))

    def test_voltages_are_noted_with_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = session(tmp, ["", "0,3", "4,7", "", "", "", "", "x", "2,5", "2,5", "", "1", "1"], FakeClock())
            s.step_voltages()
            text = notes(s)
            self.assertIn("pino 6 = 0.30 V, pino 14 = 4.70 V → CAN tolerante a falhas", text)
            self.assertIn("tensão B (Ignição desligada, porta do motorista aberta): não medida", text)
            self.assertIn("tensão C (Ignição ligada, motor desligado): pino 6 = 2.50 V", text)


class ActionsTest(unittest.TestCase):

    def test_full_sequence_reads_every_stage_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            answers = [""] * sum(len(stages) for _, stages in rt.ACTIONS)
            s = session(tmp, answers, FakeClock())
            s.step_actions()
            [rec] = FakeRecorder.instances
            expected = []
            for _, stages in rt.ACTIONS:
                for _, label in stages:
                    expected += [f"{label} inicio", f"{label} fim"]
            self.assertEqual(expected, rec.marks)
            self.assertEqual(os.path.join(tmp, "acoes.log"), rec.path)

    def test_reading_ends_by_itself_after_the_set_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock = FakeClock()
            stages = len(rt.ACTIONS[1][1])
            s = session(tmp, [""] * stages, clock, step_s=0.0)        # nenhuma resposta além de um Enter por etapa
            s.step_actions(only=[1])                                   # seta esquerda
            self.assertEqual(stages * rt.READ_S, clock.t)

    def test_each_test_announces_itself_and_the_next_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = session(tmp, ["", "", ""], FakeClock())
            lines = []
            s.out = lines.append
            s.step_actions(only=[1])
            text = "\n".join(lines)
            self.assertIn("INÍCIO DO TESTE 1 de 1: Seta esquerda", text)
            self.assertIn("FIM DO TESTE 1 de 1: Seta esquerda", text)
            self.assertLess(text.index("Deixe a seta desligada"), text.index("Ligue a seta esquerda"))

    def test_redo_and_skip_are_marked(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = session(tmp, ["", "r", "", "", "", "p"], FakeClock())
            idx = [i for i, (name, _) in enumerate(rt.ACTIONS) if name in ("Seta esquerda", "Seta direita")]
            s.step_actions(only=idx)
            [rec] = FakeRecorder.instances
            first = ["seta esq: desligada inicio", "seta esq: desligada fim"]
            rest = ["seta esq: ligada inicio", "seta esq: ligada fim",
                    "seta esq: desligada de novo inicio", "seta esq: desligada de novo fim"]
            self.assertEqual(first + ["refazer Seta esquerda"] + first + rest, rec.marks)
            self.assertIn("Seta esquerda", s.done)
            self.assertNotIn("Seta direita", s.done)
            self.assertIn("ação 'Seta direita': pulada", notes(s))

    def test_recordings_never_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = session(tmp, [""] * 6, FakeClock())
            s.step_actions(only=[1])
            s.step_actions(only=[1])
            self.assertEqual(["acoes.log", "acoes_2.log"], [os.path.basename(r.path) for r in FakeRecorder.instances])


class ReceptionTest(unittest.TestCase):

    def run_reception(self, tmp, content, answers):
        class Writing(FakeRecorder):
            def start(self):
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(content)
                return self

        s = session(tmp, answers, FakeClock())
        s.recorder = Writing
        lines = []
        s.out = lines.append
        return s.step_reception(), lines

    def test_corrupted_line_is_not_reception(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, lines = self.run_reception(tmp, "1 ada a 500 kbps\n2 # stats quadros=0\n", ["", "p"])
            self.assertFalse(ok)
            self.assertFalse(any("Recepção ok" in line for line in lines))

    def test_valid_frame_is_reception(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, lines = self.run_reception(tmp, "1 t2808000000000A000000\n", [""])
            self.assertTrue(ok)
            self.assertTrue(any("1 quadros de 1 IDs" in line for line in lines))


class OdometerTest(unittest.TestCase):

    def test_panel_values_and_recording(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = session(tmp, ["", "", "", "12345", "67,8", "1/2", ""], FakeClock())
            s.step_odometer("antes")
            self.assertIn("hodômetro antes: total = 12345 km, parcial = 67,8 km, tanque = 1/2", notes(s))
            [rec] = FakeRecorder.instances
            self.assertEqual("odo_antes.log", os.path.basename(rec.path))


if __name__ == "__main__":
    unittest.main()
