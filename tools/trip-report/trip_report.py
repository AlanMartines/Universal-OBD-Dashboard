#!/usr/bin/env python3
"""Recalcula viagens a partir das gravações de diagnóstico (.jsonl / .jsonl.gz) do app.

Relê as respostas brutas do ELM327 com as fórmulas do perfil JSON *atual* (corrigindo gravações
feitas com fórmulas antigas), refaz o consumo como o app (FuelCalculator), agrupa as sessões em
viagens com a mesma regra de retomada do app e gera:

  * relatório por viagem: distância, tempo, consumo estimado, marcha lenta, corte de injeção,
    tempo em cada marcha, temperaturas e tensões;
  * calibração do consumo: com os litros reais de um abastecimento, sugere `volumetric_efficiency`;
  * reprodução para o protótipo do painel (--replay): um trecho a 1 Hz, sem coordenadas GPS nem VIN.

Uso:
  python3 tools/trip-report/trip_report.py DIR_OU_ARQUIVOS... [--profile PERFIL.json]
      [--ethanol-pct 0] [--since 2026-10-23T13:00] [--until ...] [--actual-liters 31.5]
      [--fuel-csv abastecimentos.csv]   # CSV exportado na aba Abastecimentos: calibra cada intervalo
      [--json saida.json] [--replay replay.json --replay-minutes 20 [--replay-start ...]]

Só usa a biblioteca padrão do Python 3.
"""
import argparse
import bisect
import csv
import datetime as dt
import glob
import gzip
import json
import math
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_PROFILE = os.path.join(REPO, 'app', 'src', 'main', 'assets', 'profiles', 'fiat_uno_vivace_7gf.json')

STALE_MS = 10_000            # DashboardState.STALE_AFTER_MS
R_AIR = 287.05               # FuelCalculator
MAX_TRIM_PCT = 30.0          # FuelCalculator.MAX_TRIM_PCT
MANUAL_END_REASONS = {'user_stop', 'idle_confirmed'}   # CapturePolicy.MANUAL_END_REASONS
NAN = float('nan')

# =============================================================================================
#  Avaliador de fórmulas — mesma gramática e semântica de FormulaEvaluator (ProfileParser.kt)
# =============================================================================================


class FormulaError(ValueError):
    pass


def _truthy(v):
    return not math.isnan(v) and v != 0.0


def _b(x):
    return 1.0 if x else 0.0


def _signed8(x):
    if math.isnan(x):
        return NAN
    v = int(x) & 0xFF
    return float(v - 256 if v > 127 else v)


def _signed16(x):
    if math.isnan(x):
        return NAN
    v = int(x) & 0xFFFF
    return float(v - 65536 if v > 32767 else v)


def _round(a):
    f = 10.0 ** a[1] if len(a) > 1 else 1.0
    return float(round(a[0] * f)) / f if not math.isnan(a[0]) else NAN


FUNCTIONS = {
    'min': ((2, 16), lambda a: min(a)),
    'max': ((2, 16), lambda a: max(a)),
    'abs': ((1, 1), lambda a: abs(a[0])),
    'round': ((1, 2), _round),
    'floor': ((1, 1), lambda a: float(math.floor(a[0])) if math.isfinite(a[0]) else a[0]),
    'ceil': ((1, 1), lambda a: float(math.ceil(a[0])) if math.isfinite(a[0]) else a[0]),
    'sqrt': ((1, 1), lambda a: math.sqrt(a[0]) if a[0] >= 0 else NAN),
    'clamp': ((3, 3), lambda a: NAN if math.isnan(a[0]) else min(max(a[0], a[1]), a[2])),
    'signed8': ((1, 1), lambda a: _signed8(a[0])),
    'signed16': ((1, 1), lambda a: _signed16(a[0])),
}

_TWO = {'<<', '>>', '<=', '>=', '==', '!=', '&&', '||'}
_ONE = set('+-*/%&|^<>!()?:,')


def _tokenize(src):
    out, i = [], 0
    while i < len(src):
        c = src[i]
        if c.isspace():
            i += 1
        elif c == '0' and i + 1 < len(src) and src[i + 1] in 'xX':
            j = i + 2
            while j < len(src) and src[j].isalnum():
                j += 1
            out.append(('num', float(int(src[i + 2:j], 16))))
            i = j
        elif c.isdigit() or (c == '.' and i + 1 < len(src) and src[i + 1].isdigit()):
            j = i
            while j < len(src) and (src[j].isdigit() or src[j] == '.'):
                j += 1
            out.append(('num', float(src[i:j])))
            i = j
        elif c.isalpha() or c == '_':
            j = i
            while j < len(src) and (src[j].isalnum() or src[j] == '_'):
                j += 1
            out.append(('id', src[i:j]))
            i = j
        elif src[i:i + 2] in _TWO:
            out.append(('op', src[i:i + 2]))
            i += 2
        elif c in _ONE:
            out.append(('op', c))
            i += 1
        else:
            raise FormulaError(f"caractere inesperado '{c}' em {src!r}")
    out.append(('end', None))
    return out


def _bitwise(op):
    def f(a, b):
        if math.isnan(a) or math.isnan(b):
            return NAN
        x, y = int(a), int(b)
        return float({'&': x & y, '|': x | y, '^': x ^ y, '<<': x << y, '>>': x >> y}[op])
    return f


def _div(a, b):
    if b == 0:
        return NAN if a == 0 or math.isnan(a) else math.copysign(math.inf, a)
    return a / b


def _mod(a, b):
    return NAN if b == 0 else math.fmod(a, b)


_BIN = {
    '+': lambda a, b: a + b, '-': lambda a, b: a - b, '*': lambda a, b: a * b, '/': _div, '%': _mod,
    '==': lambda a, b: _b(a == b), '!=': lambda a, b: _b(a != b),
    '<': lambda a, b: _b(a < b), '<=': lambda a, b: _b(a <= b), '>': lambda a, b: _b(a > b), '>=': lambda a, b: _b(a >= b),
    '&': _bitwise('&'), '|': _bitwise('|'), '^': _bitwise('^'), '<<': _bitwise('<<'), '>>': _bitwise('>>'),
}
_LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']]


def compile_formula(src):
    """Compila a fórmula em uma função f(resolver) -> float; resolver(nome) devolve float ou NaN."""
    toks = _tokenize(src)
    pos = [0]

    def peek():
        return toks[pos[0]]

    def is_op(*syms):
        t = peek()
        return t[0] == 'op' and t[1] in syms

    def expect(sym):
        if not is_op(sym):
            raise FormulaError(f"esperado '{sym}' em {src!r}")
        pos[0] += 1

    def ternary():
        cond = level(0)
        if not is_op('?'):
            return cond
        pos[0] += 1
        a = ternary()
        expect(':')
        b = ternary()

        def f(r):
            c = cond(r)
            if math.isnan(c):
                return NAN
            return a(r) if _truthy(c) else b(r)
        return f

    def level(n):
        if n == len(_LEVELS):
            return unary()
        left = level(n + 1)
        while is_op(*_LEVELS[n]):
            op = toks[pos[0]][1]
            pos[0] += 1
            right = level(n + 1)
            left = _make_bin(op, left, right)
        return left

    def unary():
        if is_op('-', '+', '!'):
            op = toks[pos[0]][1]
            pos[0] += 1
            x = unary()
            if op == '-':
                return lambda r: -x(r)
            if op == '!':
                return lambda r: NAN if math.isnan(x(r)) else _b(not _truthy(x(r)))
            return x
        return primary()

    def primary():
        kind, val = toks[pos[0]]
        pos[0] += 1
        if kind == 'num':
            return lambda r, v=val: v
        if kind == 'id':
            if not is_op('('):
                return lambda r, n=val: r(n)
            fn = FUNCTIONS.get(val.lower())
            if fn is None:
                raise FormulaError(f"função desconhecida '{val}' em {src!r}")
            pos[0] += 1
            args = []
            if not is_op(')'):
                while True:
                    args.append(ternary())
                    if is_op(','):
                        pos[0] += 1
                        continue
                    break
            expect(')')
            (lo, hi), impl = fn
            if not lo <= len(args) <= hi:
                raise FormulaError(f"função '{val}' espera {lo}..{hi} argumentos em {src!r}")
            return lambda r, a=args, i=impl: i([x(r) for x in a])
        if kind == 'op' and val == '(':
            e = ternary()
            expect(')')
            return e
        raise FormulaError(f"símbolo inesperado {val!r} em {src!r}")

    if peek()[0] == 'end':
        raise FormulaError('fórmula vazia')
    expr = ternary()
    if peek()[0] != 'end':
        raise FormulaError(f"símbolo inesperado {peek()[1]!r} em {src!r}")
    return expr


def _make_bin(op, left, right):
    if op == '&&':
        return lambda r: _b(_truthy(left(r)) and _truthy(right(r)))
    if op == '||':
        return lambda r: _b(_truthy(left(r)) or _truthy(right(r)))
    f = _BIN[op]
    return lambda r: f(left(r), right(r))


def eval_bytes(expr, data):
    """Fórmula de resposta OBD: A, B, C... = bytes de dados (FormulaEvaluator.evaluateBytes)."""
    def r(name):
        if len(name) == 1 and 'A' <= name <= 'Z':
            i = ord(name) - 65
            return float(data[i]) if i < len(data) else NAN
        return NAN
    return expr(r)


# =============================================================================================
#  Perfil e respostas do ELM327
# =============================================================================================

class Profile:
    def __init__(self, path):
        with open(path, encoding='utf-8') as fh:
            self.raw = json.load(fh)
        p = self.raw
        self.id = p['profile_id']
        self.roles = {'rpm': 'rpm', 'speed': 'speed', 'throttle': 'throttle', 'map': 'map', 'maf': None,
                      'coolant_temp': 'coolant_temp', 'intake_temp': 'intake_temp', 'battery_volts': 'battery_volts',
                      'timing_advance': 'timing_advance', 'engine_load': 'engine_load', 'stft': 'stft_b1', 'ltft': 'ltft_b1',
                      'lambda_voltage': 'lambda_b1s1_v', 'mil_on': 'mil_on', 'dtc_count': 'dtc_count'}
        self.roles.update(p.get('roles', {}))
        self.outputs = {}       # id -> meta
        self.commands = {}      # comando (sem sufixo) -> [(saída, expr, bytes, decoder)]
        for lane, pids in p['pids'].items():
            for d in pids:
                decoder = d.get('decoder', 'formula').lower()
                if decoder == 'dtc':
                    continue
                outs = ([{'id': d['id'], 'formula': d['formula'], 'decimals': d.get('decimals', 0)}] if d.get('formula') else []) + d.get('outputs', [])
                cmd = d['command'].replace(' ', '').upper()
                for o in outs:
                    self.outputs[o['id']] = {'decimals': o.get('decimals', 0), 'lane': lane}
                    self.commands.setdefault(cmd, []).append((o['id'], compile_formula(o['formula']), d.get('bytes'), 'formula'))
                fb = d.get('fallback_command')
                if fb:
                    fdec = (d.get('fallback_decoder') or decoder).lower()
                    ff = d.get('fallback_formula') or ('V' if fdec in ('elm_voltage', 'atrv') else d.get('formula'))
                    self.commands.setdefault(fb.replace(' ', '').upper(), []).append((d['id'], compile_formula(ff), None, 'volt' if fdec in ('elm_voltage', 'atrv') else 'formula'))
        self.fuel = p.get('fuel')
        self.decel = compile_formula(self.fuel['decel_fuel_cut_condition']) if self.fuel and self.fuel.get('decel_fuel_cut_condition') else None
        si = p.get('shift_indicator') or {}
        self.upshift = si.get('upshift_speeds_kmh', [])
        self.ratios = si.get('gear_kmh_per_1000rpm', [])
        self.ratio_tol = si.get('gear_match_tolerance', 0.12)
        self.upshift_rpm_hint = si.get('upshift_rpm_hint', 2500.0)
        self.max_tps_hint = si.get('max_tps_for_hint_pct', 60.0)
        levels = {'info': 'INFO', 'warning': 'WARNING', 'warn': 'WARNING', 'critical': 'CRITICAL', 'danger': 'CRITICAL'}
        self.alerts = [(a['id'], levels[a.get('level', 'warning').lower()], compile_formula(a['condition']),
                        a['message'], a.get('sustain_ms', 0)) for a in p.get('alerts', [])]
        self.dashboard = p.get('dashboard', {})
        self.obd_speed_factor = p.get('obd_speed_factor', 1.0)
        self.thermal = p.get('thermal')
        self.power = p.get('power_management', {})


_VOLT = re.compile(r'(\d{1,2}(?:[.,]\d{1,2})?)\s*V', re.I)
_ERRORS = ('NO DATA', 'UNABLE', 'BUFFER FULL', 'STOPPED', 'ERROR', 'BUS BUSY', '?')


def parse_response(rx):
    """Mensagens (listas de bytes) de uma resposta ELM327 com ATS0/ATH0, ou None se erro/NO DATA."""
    lines = [l.strip() for l in re.split(r'[\r\n]', rx.replace('\x00', ''))]
    lines = [l for l in lines if l and not l.upper().startswith('SEARCHING')
             and not (l.upper().startswith('BUS INIT') and l.upper().endswith('OK'))]
    joined = ' '.join(lines).upper()
    if not lines or any(e in joined for e in _ERRORS):
        return None
    msgs = []
    for l in lines:
        h = l.replace(' ', '').upper()
        if len(h) % 2 == 0 and re.fullmatch(r'[0-9A-F]+', h):
            msgs.append(list(bytes.fromhex(h)))
    return msgs or None


def decode(profile, cmd, rx):
    """{saída: valor} de um par comando/resposta, com as fórmulas do perfil."""
    c = cmd.replace(' ', '').upper()
    if c.startswith('01') and len(c) == 5:   # sufixo de contagem de respostas (010C1)
        c = c[:4]
    defs = profile.commands.get(c)
    if not defs:
        return {}
    out = {}
    if defs[0][3] == 'volt':
        m = _VOLT.search(rx)
        if m:
            v = float(m.group(1).replace(',', '.'))
            for oid, expr, _, _ in defs:
                val = expr(lambda n, v=v: v if n == 'V' else NAN)
                if math.isfinite(val):
                    out[oid] = val
        return out
    msgs = parse_response(rx)
    if not msgs:
        return {}
    header = list(bytes.fromhex(c))
    header[0] += 0x40
    msg = next((m for m in msgs if m[:len(header)] == header), None)
    if msg is None:
        return {}
    data = msg[len(header):]
    for oid, expr, nbytes, _ in defs:
        if nbytes and len(data) < nbytes:
            continue
        v = eval_bytes(expr, data)
        if math.isfinite(v):
            out[oid] = v
    return out


# =============================================================================================
#  Leitura das sessões e agrupamento em viagens (regra de retomada do app)
# =============================================================================================

def load_sessions(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            files += glob.glob(os.path.join(p, 'diag_*.jsonl*'))
        else:
            files.append(p)
    sessions = []
    for f in sorted(set(files)):
        opener = gzip.open if f.endswith('.gz') else open
        events = []
        with opener(f, 'rt', encoding='utf-8') as fh:
            for line in fh:
                try:
                    events.append(json.loads(line))
                except ValueError:
                    pass
        if events:
            stop = next((e.get('reason') for e in reversed(events) if e.get('type') == 'stop'), None)
            sessions.append({'file': os.path.basename(f), 'events': events, 'start': events[0]['t'], 'end': events[-1]['t'], 'stop': stop})
    sessions.sort(key=lambda s: s['start'])
    return sessions


def group_trips(sessions, window_min):
    trips = []
    for s in sessions:
        if trips:
            prev = trips[-1][-1]
            gap = s['start'] - prev['end']
            if 0 <= gap <= window_min * 60_000 and prev['stop'] not in MANUAL_END_REASONS:
                trips[-1].append(s)
                continue
        trips.append([s])
    return trips


# =============================================================================================
#  Reconstrução a 1 Hz: valores decodificados, consumo, marcha, alertas
# =============================================================================================

class Series:
    def __init__(self):
        self.t, self.v = [], []

    def add(self, t, v):
        self.t.append(t)
        self.v.append(v)

    def at(self, t, max_age=STALE_MS):
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0 or t - self.t[i] > max_age:
            return None
        return self.v[i]


def blend(fuel, ethanol_pct):
    g = fuel.get('gasoline', {'afr': 14.7, 'density_g_per_l': 745.0})
    e = fuel.get('ethanol')
    if not e:
        return g['afr'], g['density_g_per_l']
    v = min(1.0, max(0.0, ethanol_pct / 100.0))
    me, mg = v * e['density_g_per_l'], (1 - v) * g['density_g_per_l']
    w = me / (me + mg)
    return w * e['afr'] + (1 - w) * g['afr'], me + mg


def liters_per_hour(profile, vals, ethanol_pct, ve=None):
    """Igual a FuelCalculator.litersPerHour (com o limite de ±30% nos trims)."""
    f = profile.fuel
    rpm = vals.get(profile.roles.get('rpm'))
    if not f or rpm is None:
        return None
    if rpm < 300:
        return 0.0
    if profile.decel and _truthy(profile.decel(lambda n: vals.get(n, NAN) if vals.get(n) is not None else NAN)):
        return 0.0
    mapk = vals.get(profile.roles.get('map'))
    maf = vals.get(profile.roles.get('maf')) if profile.roles.get('maf') else None
    iat = vals.get(profile.roles.get('intake_temp'))
    if f.get('method') == 'maf' and maf is not None:
        air = maf
    elif mapk is not None:
        air = mapk * 1000.0 * (f.get('displacement_l', 1.0) / 1000.0) * (rpm / 120.0) * (ve if ve is not None else f.get('volumetric_efficiency', 0.8)) \
            / (R_AIR * ((iat if iat is not None else 25.0) + 273.15)) * 1000.0
    elif maf is not None:
        air = maf
    else:
        return None
    afr, dens = blend(f, ethanol_pct)
    st = vals.get(profile.roles.get('stft')) if profile.roles.get('stft') else None
    lt = vals.get(profile.roles.get('ltft')) if profile.roles.get('ltft') else None
    trim = 1.0 + max(-MAX_TRIM_PCT, min(MAX_TRIM_PCT, (st or 0.0) + (lt or 0.0))) / 100.0
    return air / afr * trim * 3600.0 / dens


def shift_advice(profile, speed, rpm, tps):
    if speed is None or speed < 3:
        return (1 if speed is not None else None), None, False
    rec = 1 + sum(1 for x in profile.upshift if speed >= x)
    est = None
    if profile.ratios and rpm is not None and rpm >= 900:
        r = speed / (rpm / 1000.0)
        i = min(range(len(profile.ratios)), key=lambda k: abs(r - profile.ratios[k]) / profile.ratios[k])
        if abs(r - profile.ratios[i]) / profile.ratios[i] <= profile.ratio_tol:
            est = i + 1
    light = tps is None or tps < profile.max_tps_hint
    if not light:
        up = False
    elif est is not None:
        up = est < rec
    elif rpm is not None:
        up = rpm > profile.upshift_rpm_hint and speed >= (profile.upshift[0] if profile.upshift else 1e9)
    else:
        up = False
    return rec, est, up


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    x = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(x))


def fmt_msg(template, vals, profile):
    def rep(m):
        k = m.group(1)
        v = vals.get(k)
        if v is None:
            return '--'
        d = profile.outputs.get(k, {}).get('decimals', 1)
        return f"{v:.{max(0, min(4, d))}f}".replace('.', ',')
    return re.sub(r'\{([A-Za-z_][A-Za-z0-9_]*)\}', rep, template)


def rebuild(profile, trip_sessions, ethanol_pct, ve=None, frames=False, window=(None, None)):
    """Reconstrói a viagem a 1 Hz. Devolve (estatísticas, quadros para reprodução ou []).

    [window] = (início, fim) em ms: só os segundos dentro do período entram nas estatísticas
    (para calibrar entre dois abastecimentos que caem no meio de uma sessão).
    """
    series = {}
    gps = []    # (t, lat, lon, speed, acc)
    for s in trip_sessions:
        for e in s['events']:
            if e.get('type') == 'elm' and 'rx' in e:
                for k, v in decode(profile, e['cmd'], e['rx']).items():
                    series.setdefault(k, Series()).add(e['t'], v)
            elif e.get('type') == 'snapshot' and 'gps' in e:
                g = e['gps']
                if 'lat' in g and 'lon' in g:
                    gps.append((e['t'], g['lat'], g['lon'], g.get('speed_kmh'), g.get('accuracy_m', 99)))
    gps_t = [g[0] for g in gps]
    R = profile.roles
    stats = {'seconds': 0, 'stream_s': 0, 'dist_obd_km': 0.0, 'dist_gps_km': 0.0, 'fuel_l': 0.0, 'idle_s': 0, 'idle_l': 0.0,
             'cut_s': 0, 'moving_s': 0, 'gears': {}, 'alerts': {}, 'vals': {}}
    out_frames = []
    alert_since, active = {}, {}
    last_fix = None
    t_start = trip_sessions[0]['start']
    for s in trip_sessions:
        t = max(s['start'], window[0]) if window[0] else s['start']
        end = min(s['end'], window[1]) if window[1] else s['end']
        while t <= end:
            stats['seconds'] += 1
            vals = {k: v for k, ser in series.items() if (v := ser.at(t)) is not None}
            speed, rpm = vals.get(R.get('speed')), vals.get(R.get('rpm'))
            tps = vals.get(R.get('throttle'))
            if rpm is not None:
                stats['stream_s'] += 1
            for k in (R.get('rpm'), R.get('speed'), R.get('coolant_temp'), R.get('intake_temp'), R.get('battery_volts'),
                      R.get('map'), R.get('throttle'), R.get('timing_advance'), R.get('stft'), R.get('engine_load')):
                if k and k in vals:
                    stats['vals'].setdefault(k, []).append(vals[k])
            lph = liters_per_hour(profile, vals, ethanol_pct, ve)
            if lph is not None:
                stats['fuel_l'] += lph / 3600.0
            if speed is not None:
                stats['dist_obd_km'] += speed * profile.obd_speed_factor / 3600.0
                if speed < 1 and rpm is not None and rpm > 300:
                    stats['idle_s'] += 1
                    stats['idle_l'] += (lph or 0) / 3600.0
                if speed >= 1:
                    stats['moving_s'] += 1
            if lph == 0.0 and rpm is not None and rpm > 300:
                stats['cut_s'] += 1
            rec, est, up = shift_advice(profile, speed, rpm, tps)
            if speed is not None and speed > 8:
                key = str(est) if est else 'transição'
                stats['gears'][key] = stats['gears'].get(key, 0) + 1
            # GPS (como TripAccumulator.onGpsFix: precisão <= 25 m, velocidade >= 2 km/h, salto < 250 km/h)
            j = bisect.bisect_right(gps_t, t) - 1
            fix = gps[j] if j >= 0 and t - gps[j][0] < 5000 else None
            if fix and fix[4] <= 25 and fix is not last_fix:
                if last_fix and (fix[3] or 0) >= 2:
                    d = haversine_km(last_fix[1:3], fix[1:3])
                    dts = (fix[0] - last_fix[0]) / 1000.0
                    if dts > 0 and d * 1000 / dts < 70:
                        stats['dist_gps_km'] += d
                last_fix = fix
            # Alertas (AlertEngine com sustain)
            dist_km = stats['dist_obd_km']
            kml = speed / lph if lph and lph > 0.05 and speed and speed > 5 else None
            extra = {'gps_speed': fix[3] if fix and fix[3] is not None else NAN, 'fuel_lph': lph if lph is not None else NAN,
                     'fuel_kml': kml if kml is not None else NAN, 'fuel_remaining_l': NAN, 'trip_distance_km': dist_km,
                     'dtc_confirmed_count': 0.0, 'dtc_pending_count': 0.0}
            res = lambda n, v=vals, x=extra: v[n] if n in v else x.get(n, NAN)
            for aid, level, cond, msg, sustain in profile.alerts:
                if _truthy(cond(res)):
                    since = alert_since.setdefault(aid, t)
                    if t - since >= sustain:
                        if aid not in active:
                            stats['alerts'][aid] = stats['alerts'].get(aid, 0) + 1
                        active[aid] = (level, fmt_msg(msg, {**vals, **{k: v for k, v in extra.items() if not math.isnan(v)}}, profile), since)
                else:
                    alert_since.pop(aid, None)
                    active.pop(aid, None)
            if frames:
                order = {'CRITICAL': 0, 'WARNING': 1, 'INFO': 2}
                out_frames.append({
                    's': round((t - t_start) / 1000),
                    'readings': {k: round(v, 3) for k, v in vals.items()},
                    'derived': {'fuelLph': None if lph is None else round(lph, 3), 'instantKmPerL': None if kml is None else round(kml, 2),
                                'tripKmPerL': round(dist_km / stats['fuel_l'], 2) if stats['fuel_l'] > 0.05 else None,
                                'tripFuelUsedL': round(stats['fuel_l'], 3), 'fuelRemainingL': None,
                                'recommendedGear': rec, 'estimatedGear': est, 'shiftUp': up},
                    'gps': {'speedKmh': round(fix[3], 1), 'accuracyM': fix[4], 'ageMs': 0} if fix and fix[3] is not None else None,
                    'alerts': [{'id': k, 'level': a[0], 'message': a[1]} for k, a in sorted(active.items(), key=lambda kv: order.get(kv[1][0], 3))],
                    'tripDistanceKm': round(dist_km, 3),
                    'connection': 'STREAMING' if rpm is not None else 'RECONNECTING',
                })
            t += 1000
    return stats, out_frames


# =============================================================================================
#  Relatório
# =============================================================================================

def hms(s):
    return f"{int(s // 3600)}h{int(s % 3600 // 60):02d}"


def when(ms):
    return dt.datetime.fromtimestamp(ms / 1000).strftime('%d/%m %H:%M')


def trip_ethanol(profile, trip, ethanol_pct):
    """% de etanol da viagem: o informado na linha de comando; senão o que o app gravou no início
    (session.ethanol_pct, v0.9.1+); senão o padrão do perfil."""
    if ethanol_pct is not None:
        return ethanol_pct
    for s in trip:
        for e in s['events']:
            if e.get('type') == 'session' and e.get('ethanol_pct') is not None:
                return float(e['ethanol_pct'])
    return (profile.fuel or {}).get('default_ethanol_pct', 0.0)


def report(profile, trips, ethanol_pct, ve, window=(None, None)):
    rows = []
    for n, trip in enumerate(trips, 1):
        e = trip_ethanol(profile, trip, ethanol_pct)
        st, _ = rebuild(profile, trip, e, ve, window=window)
        st['ethanol_pct'] = e
        if st['seconds']:
            rows.append((n, trip, st))
    return rows


def print_report(profile, rows, ethanol_pct, ve):
    ve_used = ve if ve is not None else (profile.fuel or {}).get('volumetric_efficiency')
    eth = f"{ethanol_pct:g}%" if ethanol_pct is not None else "o gravado em cada viagem"
    print(f"Perfil: {profile.id} · etanol: {eth} · volumetric_efficiency {ve_used}")
    print("Consumo ESTIMADO pelo MAP (speed-density); só vale depois de calibrar com um abastecimento real.\n")
    tot = {'dist': 0.0, 'fuel': 0.0, 's': 0}
    for n, trip, st in rows:
        dist = st['dist_gps_km'] if st['dist_gps_km'] > 0.8 * st['dist_obd_km'] else st['dist_obd_km']
        tot['dist'] += dist
        tot['fuel'] += st['fuel_l']
        tot['s'] += st['seconds']
        reasons = ' → '.join(s['stop'] or '?' for s in trip)
        print(f"Viagem {n}: {when(trip[0]['start'])} – {when(trip[-1]['end'])} · {len(trip)} sessão(ões) · fim: {reasons}")
        print(f"  tempo {hms(st['seconds'])} (em movimento {hms(st['moving_s'])}, parado ligado {hms(st['idle_s'])}) · captura {st['stream_s'] * 100 / max(1, st['seconds']):.1f}%")
        print(f"  distância {dist:.1f} km (OBD {st['dist_obd_km']:.1f} · GPS {st['dist_gps_km']:.1f}) · etanol {st['ethanol_pct']:g}%")
        kml = dist / st['fuel_l'] if st['fuel_l'] > 0.05 else float('nan')
        print(f"  combustível estimado {st['fuel_l']:.2f} L → {kml:.1f} km/l · parado ligado {st['idle_l']:.2f} L · corte de injeção {st['cut_s'] * 100 / max(1, st['stream_s']):.1f}% do tempo")
        g = st['gears']
        gt = sum(g.values()) or 1
        print('  marchas: ' + ' '.join(f"{k}ª {v * 100 / gt:.0f}%" if k != 'transição' else f"transição {v * 100 / gt:.0f}%"
                                      for k, v in sorted(g.items(), key=lambda kv: (kv[0] == 'transição', kv[0]))))
        parts = []
        for k, label, d in ((profile.roles.get('coolant_temp'), 'motor °C', 0), (profile.roles.get('intake_temp'), 'ar °C', 0),
                            (profile.roles.get('battery_volts'), 'bateria V', 1), (profile.roles.get('rpm'), 'rpm', 0)):
            a = st['vals'].get(k)
            if a:
                a = sorted(a)
                parts.append(f"{label} {a[len(a) // 20]:.{d}f}/{statistics.median(a):.{d}f}/{a[-1]:.{d}f}")
        print('  p5/mediana/máx: ' + ' · '.join(parts))
        if st['alerts']:
            print('  alertas: ' + ', '.join(f"{k} ×{v}" for k, v in st['alerts'].items()))
        print()
    if rows:
        print(f"TOTAL: {tot['dist']:.0f} km em {hms(tot['s'])} · combustível estimado {tot['fuel']:.1f} L → "
              f"{(tot['dist'] / tot['fuel']) if tot['fuel'] > 0 else float('nan'):.1f} km/l")
    return tot


def pick_window(frames, minutes):
    """Trecho com mais variedade: marchas diferentes, parada com motor ligado e velocidade alta."""
    w = minutes * 60
    best, best_score = 0, -1
    for start in range(0, max(1, len(frames) - w), 60):
        seg = frames[start:start + w]
        gears = {f['derived']['estimatedGear'] for f in seg if f['derived']['estimatedGear']}
        idle = sum(1 for f in seg if (f['readings'].get('speed') or 0) < 1 and (f['readings'].get('rpm') or 0) > 300)
        vmax = max((f['readings'].get('speed') or 0) for f in seg)
        stream = sum(1 for f in seg if f['connection'] == 'STREAMING') / len(seg)
        score = len(gears) * 10 + min(idle, 90) / 9 + vmax / 10 + (20 if stream > 0.98 else 0)
        if score > best_score:
            best, best_score = start, score
    return best


# =============================================================================================
#  Abastecimentos (CSV exportado pelo app) — mesma regra de FuelLog.intervals
# =============================================================================================

def load_fuel_csv(path):
    rows = []
    with open(path, encoding='utf-8', newline='') as fh:
        for r in csv.DictReader(fh):
            num = lambda k: float(r[k].replace(',', '.')) if r.get(k, '').strip() else None
            ts = dt.datetime.fromisoformat(r['data_hora'].strip())
            rows.append({'t': int(ts.timestamp() * 1000), 'odo': num('hodometro_km'), 'liters': num('litros'),
                         'cost': num('valor_total'), 'type': (r.get('combustivel') or 'gasoline').strip(),
                         'full': (r.get('tanque_cheio') or 'sim').strip().lower() not in ('nao', 'não', '0', 'false', 'n')})
    return sorted(rows, key=lambda x: x['t'])


def fuel_intervals(rows):
    """Intervalos entre tanques cheios com hodômetro: litros = colocados depois do início até o fim (inclusive)."""
    out, start, liters = [], None, 0.0
    for f in rows:
        if start is not None:
            liters += f['liters']
        if f['full']:
            if start is not None and start['odo'] is not None and f['odo'] is not None and f['odo'] > start['odo'] and liters > 0:
                out.append({'from': start, 'to': f, 'km': f['odo'] - start['odo'], 'liters': liters, 'type': start['type']})
            start, liters = f, 0.0
    return out


def build_meta(profile):
    p = profile.raw
    r = profile.roles
    return {
        'id': profile.id, 'vehicleName': p.get('vehicle_name'), 'ecuModel': p.get('ecu_model'),
        'roles': {'rpm': r.get('rpm'), 'speed': r.get('speed'), 'coolant': r.get('coolant_temp'), 'voltage': r.get('battery_volts'),
                  'throttle': r.get('throttle'), 'map': r.get('map'), 'intake': r.get('intake_temp'), 'engineLoad': r.get('engine_load'),
                  'timing': r.get('timing_advance'), 'stft': r.get('stft'), 'ltft': r.get('ltft'), 'lambda': r.get('lambda_voltage'),
                  'milOn': r.get('mil_on'), 'dtcCount': r.get('dtc_count')},
        'dashboard': {'rpmMax': profile.dashboard.get('rpm_max', 7000), 'rpmRedline': profile.dashboard.get('rpm_redline', 6000),
                      'speedMax': profile.dashboard.get('speed_max', 200)},
        'thermal': {'thermostatOpenC': profile.thermal['thermostat_open_c'], 'fanStage1C': profile.thermal['fan_stage1_c'],
                    'fanStage2C': profile.thermal['fan_stage2_c'], 'criticalC': profile.thermal['critical_c']} if profile.thermal else None,
        'fuel': {'tankCapacityL': profile.fuel['tank_capacity_l'], 'reserveMinL': profile.fuel.get('reserve_min_l', 0),
                 'reserveMaxL': profile.fuel.get('reserve_max_l', 0), 'flex': 'ethanol' in profile.fuel} if profile.fuel else None,
        'upshiftSpeedsKmh': profile.upshift, 'outputs': [],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('inputs', nargs='+', help='pastas ou arquivos diag_*.jsonl(.gz)')
    ap.add_argument('--profile', default=DEFAULT_PROFILE)
    ap.add_argument('--ethanol-pct', type=float, default=None,
                    help='%% de etanol da bomba no tanque (padrão: o gravado pelo app em cada viagem, ou o do perfil)')
    ap.add_argument('--ve', type=float, default=None, help='volumetric_efficiency a usar (padrão: a do perfil)')
    ap.add_argument('--resume-window-min', type=int, default=60)
    ap.add_argument('--since', help='início do período (AAAA-MM-DDTHH:MM, hora local)')
    ap.add_argument('--until', help='fim do período')
    ap.add_argument('--actual-liters', type=float, help='litros reais abastecidos para o período → sugere volumetric_efficiency')
    ap.add_argument('--fuel-csv', help='CSV exportado na aba Abastecimentos: calibra cada intervalo entre tanques cheios')
    ap.add_argument('--json', help='grava o relatório em JSON')
    ap.add_argument('--replay', help='grava um trecho a 1 Hz para o protótipo do painel (sem GPS nem VIN)')
    ap.add_argument('--replay-minutes', type=int, default=20)
    ap.add_argument('--replay-start', help='início do trecho (AAAA-MM-DDTHH:MM); padrão: escolhido automaticamente')
    a = ap.parse_args(argv)

    profile = Profile(a.profile)
    ethanol = a.ethanol_pct
    sessions = load_sessions(a.inputs)
    ts = lambda s: int(dt.datetime.fromisoformat(s).timestamp() * 1000)
    if a.since:
        sessions = [s for s in sessions if s['end'] >= ts(a.since)]
    if a.until:
        sessions = [s for s in sessions if s['start'] <= ts(a.until)]
    if not sessions:
        sys.exit('nenhuma gravação encontrada')
    trips = group_trips(sessions, a.resume_window_min)
    window = (ts(a.since) if a.since else None, ts(a.until) if a.until else None)
    rows = report(profile, trips, ethanol, a.ve, window)
    tot = print_report(profile, rows, ethanol, a.ve)

    if a.actual_liters:
        ve0 = a.ve if a.ve is not None else profile.fuel['volumetric_efficiency']
        ve_new = ve0 * a.actual_liters / tot['fuel']
        print(f"\nCALIBRAÇÃO: estimado {tot['fuel']:.2f} L × real {a.actual_liters:.2f} L → "
              f"volumetric_efficiency sugerida {ve_new:.3f} (atual {ve0}) · consumo real {tot['dist'] / a.actual_liters:.2f} km/l")

    if a.fuel_csv:
        ve0 = a.ve if a.ve is not None else profile.fuel['volumetric_efficiency']
        print(f"\nABASTECIMENTOS ({a.fuel_csv}) · volumetric_efficiency atual {ve0}")
        real_sum = est_sum = 0.0
        for iv in fuel_intervals(load_fuel_csv(a.fuel_csv)):
            win = (iv['from']['t'], iv['to']['t'])
            est = sum(st['fuel_l'] for _, _, st in report(profile, trips, ethanol, a.ve, win))
            line = f"  {when(win[0])} → {when(win[1])}: {iv['km']:.1f} km · real {iv['liters']:.2f} L ({iv['km'] / iv['liters']:.2f} km/l)"
            if est > 0.5:
                real_sum += iv['liters']
                est_sum += est
                line += f" · app {est:.2f} L ({(est / iv['liters'] - 1) * 100:+.1f}%) · VE sugerida {ve0 * iv['liters'] / est:.3f}"
            else:
                line += " · sem gravação no período"
            print(line)
        if est_sum > 0:
            print(f"  GERAL: volumetric_efficiency sugerida {ve0 * real_sum / est_sum:.3f} ({(est_sum / real_sum - 1) * 100:+.1f}% hoje)")

    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            json.dump([{'trip': n, 'start': t[0]['start'], 'end': t[-1]['end'], 'sessions': [s['file'] for s in t],
                        **{k: v for k, v in st.items() if k != 'vals'}} for n, t, st in rows], fh, ensure_ascii=False, indent=1)

    if a.replay:
        best = None
        for trip in trips:
            _, frames = rebuild(profile, trip, trip_ethanol(profile, trip, ethanol), a.ve, frames=True)
            if a.replay_start:
                off = (ts(a.replay_start) - trip[0]['start']) // 1000
                if 0 <= off < len(frames):
                    best = (trip, frames, off)
                    break
            elif best is None or len(frames) > len(best[1]):
                best = (trip, frames, None)
        trip, frames, off = best
        if off is None:
            off = pick_window(frames, a.replay_minutes)
        seg = frames[off:off + a.replay_minutes * 60]
        base = seg[0]
        for f in seg:   # o trecho começa do zero (distância, combustível, tempo)
            f['s'] -= base['s']
            f['tripDistanceKm'] = round(f['tripDistanceKm'] - base['tripDistanceKm'], 3)
            d = f['derived']
            d['tripFuelUsedL'] = round(d['tripFuelUsedL'] - base['derived']['tripFuelUsedL'], 3)
            d['tripKmPerL'] = round(f['tripDistanceKm'] / d['tripFuelUsedL'], 2) if d['tripFuelUsedL'] > 0.05 else None
        start_ms = trip[0]['start'] + off * 1000
        with open(a.replay, 'w', encoding='utf-8') as fh:
            json.dump({'label': f"Viagem real · {when(start_ms)} · trecho de {len(seg) // 60} min",
                       'meta': build_meta(profile), 'frames': seg}, fh, ensure_ascii=False, separators=(',', ':'))
        print(f"\nReprodução: {a.replay} ({len(seg)} quadros a partir de {when(start_ms)}, {os.path.getsize(a.replay) // 1024} KB)")


if __name__ == '__main__':
    main()
