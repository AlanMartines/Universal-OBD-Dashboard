"""Testes da ferramenta: python3 -m unittest discover -s tools/trip-report"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import trip_report as tr  # noqa: E402

NAN = float('nan')


def ev(src, **v):
    return tr.compile_formula(src)(lambda n: v.get(n, NAN))


class FormulaTest(unittest.TestCase):
    """Mesmos casos de ObdCoreTest (FormulaEvaluator do app)."""

    def test_arithmetic_bitwise_and_functions(self):
        self.assertEqual(1726.0, tr.eval_bytes(tr.compile_formula('((A*256)+B)/4'), [0x1A, 0xF8]))
        self.assertEqual(1.0, tr.eval_bytes(tr.compile_formula('(A >> 7) & 1'), [0x83]))
        self.assertEqual(7.0, ev('1 + 2 * 3'))
        self.assertEqual(-2.0, ev('signed8(254)'))
        self.assertEqual(0.0, tr.eval_bytes(tr.compile_formula('B == 255 ? 0 : (B*100/128)-100'), [0x40, 0xFF]))
        self.assertEqual(100.0, ev('clamp(x, 0, 100)', x=150))

    def test_missing_values_make_conditions_false(self):
        self.assertFalse(tr._truthy(ev('rpm > 6250', coolant_temp=106)))
        self.assertTrue(tr._truthy(ev('coolant_temp > 105', coolant_temp=106)))
        self.assertTrue(ev('!x') != ev('!x'))  # NaN

    def test_invalid_formula(self):
        with self.assertRaises(tr.FormulaError):
            tr.compile_formula('((A*256)+B')


class DecodeTest(unittest.TestCase):
    """Bytes reais da IAW 7GF (viagem de teste) com o perfil atual do Uno."""

    @classmethod
    def setUpClass(cls):
        cls.p = tr.Profile(tr.DEFAULT_PROFILE)

    def test_uno_pids(self):
        self.assertEqual({'rpm': 950.0}, tr.decode(self.p, '010C1', '410C0ED8\r\r'))
        self.assertEqual({'timing_advance': 26.0}, tr.decode(self.p, '010E1', '410E34\r\r'))
        self.assertAlmostEqual(-3.90625, tr.decode(self.p, '01061', '4106FB\r\r')['stft_b1'])
        self.assertEqual({'throttle': 0.0}, tr.decode(self.p, '01111', '41111D\r\r'))
        self.assertEqual({'battery_volts': 13.5}, tr.decode(self.p, 'ATRV', '13.5V\r\r'))

    def test_errors_and_foreign_responses(self):
        self.assertEqual({}, tr.decode(self.p, '010C1', 'NO DATA\r\r'))
        self.assertEqual({}, tr.decode(self.p, '010C1', '410D3C\r\r'))      # resposta de outro PID
        self.assertEqual({}, tr.decode(self.p, '0107', '41070A\r\r'))       # LTFT não é lido no Uno
        self.assertEqual({'rpm': 950.0}, tr.decode(self.p, '010C', 'SEARCHING...\r410C0ED8\r\r'))

    def test_fuel_matches_app(self):
        # Mesmo cálculo de FuelCalculatorTest: trims absurdos limitados a ±30%
        vals = {'rpm': 3000.0, 'map': 70.0, 'intake_temp': 30.0}
        base = tr.liters_per_hour(self.p, vals, 0.0)
        self.assertGreater(base, 0)
        self.assertAlmostEqual(base * 0.7, tr.liters_per_hour(self.p, {**vals, 'stft_b1': -100.0}, 0.0))
        self.assertEqual(0.0, tr.liters_per_hour(self.p, {'rpm': 2500.0, 'map': 25.0}, 0.0))   # corte de injeção

    def test_gear_from_measured_ratios(self):
        self.assertEqual(5, tr.shift_advice(self.p, 88.0, 3000.0, 30.0)[1])   # 29,3 km/h por 1000 rpm
        self.assertEqual(3, tr.shift_advice(self.p, 35.0, 2000.0, 30.0)[1])   # 17,5


class TripGroupingTest(unittest.TestCase):
    """Mesma regra de CapturePolicy.tripToResume."""

    def s(self, start_min, end_min, stop):
        return {'start': start_min * 60_000, 'end': end_min * 60_000, 'stop': stop}

    def test_automatic_disconnects_resume_manual_stop_does_not(self):
        sessions = [self.s(0, 60, 'idle_timeout'), self.s(61, 120, 'bluetooth_disconnected'), self.s(130, 200, 'user_stop'),
                    self.s(201, 260, 'ignition_off'), self.s(600, 700, 'ignition_off')]
        trips = tr.group_trips(sessions, 60)
        # 1→2 inatividade e 2→3 Bluetooth retomam; 3 foi encerrada à mão; 4→5 passou de 1 h
        self.assertEqual([3, 1, 1], [len(t) for t in trips])


class WindowTest(unittest.TestCase):
    """Calibração entre abastecimentos: o período recorta a sessão segundo a segundo."""

    def test_window_clips_inside_session(self):
        p = tr.Profile(tr.DEFAULT_PROFILE)
        ev = [{'t': 0, 'type': 'session'}]
        for k in range(0, 600_001, 500):   # 10 min a 72 km/h e 2000 rpm
            ev.append({'t': k, 'type': 'elm', 'cmd': '010D1', 'rx': '410D48'})
            ev.append({'t': k, 'type': 'elm', 'cmd': '010C1', 'rx': '410C1F40'})
        s = {'start': 0, 'end': 600_000, 'events': ev, 'stop': 'user_stop'}
        full, _ = tr.rebuild(p, [s], 0.0)
        half, _ = tr.rebuild(p, [s], 0.0, window=(300_000, None))
        f = p.obd_speed_factor   # distância pela ECU corrigida para o hodômetro
        self.assertAlmostEqual(12.0 * f, full['dist_obd_km'], delta=0.05)
        self.assertAlmostEqual(6.0 * f, half['dist_obd_km'], delta=0.05)


class FuelCsvTest(unittest.TestCase):
    """Mesmo formato e regra do app (FuelLog): três tanques cheios de uma viagem de teste."""

    def test_intervals_from_exported_csv(self):
        import tempfile
        text = ('data_hora,hodometro_km,litros,valor_total,preco_litro,combustivel,etanol_pct,tanque_cheio,posto,observacao\n'
                '2026-01-10T08:15:30-04:00,10000,32.094,214.7,6.69,gasoline_premium,,sim,"Posto A, Cidade 1",\n'
                '2026-01-10T14:40:10-03:00,10418,32.203,209,6.49,gasoline_premium,,sim,Posto B,\n'
                '2026-01-11T07:05:45-03:00,10885.6,37.368,231.31,6.19,gasoline_premium,,sim,Posto C,\n')
        with tempfile.NamedTemporaryFile('w', suffix='.csv', delete=False, encoding='utf-8') as fh:
            fh.write(text)
        iv = tr.fuel_intervals(tr.load_fuel_csv(fh.name))
        os.unlink(fh.name)
        self.assertEqual(2, len(iv))
        self.assertAlmostEqual(418.0, iv[0]['km'])
        self.assertAlmostEqual(32.203, iv[0]['liters'])
        self.assertEqual(1768066810000, iv[0]['to']['t'])   # 14:40 em -03 = 13:40 em -04


class FuelParityTest(unittest.TestCase):
    """Mesma tabela que app/src/test/.../FuelParityTest.kt: o app e a ferramenta calculam o mesmo consumo."""

    def test_matches_app(self):
        here = os.path.dirname(os.path.abspath(__file__))
        table = json.load(open(os.path.join(here, 'fixtures', 'fuel_parity.json'), encoding='utf-8'))
        profile = tr.Profile(os.path.join(here, '..', '..', table['profile']))
        for i, c in enumerate(table['cases']):
            vals = {k: c[k] for k in ('rpm', 'map', 'intake_temp', 'stft_b1', 'throttle', 'speed')}
            got = tr.liters_per_hour(profile, vals, c['ethanol_pct'])
            if c['lph'] is None:
                self.assertIsNone(got, f'caso {i}')
            else:
                self.assertAlmostEqual(c['lph'], got, places=9, msg=f'caso {i}')


if __name__ == '__main__':
    unittest.main()
