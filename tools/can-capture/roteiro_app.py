#!/usr/bin/env python3
"""Analisa um arquivo de diagnóstico do app com marcas do Roteiro de captura.

O app grava, no mesmo arquivo e no mesmo relógio, os quadros do ESP32 (eventos "esp32") e as marcas
de cada passo (eventos "mark": step_start, on, off, phase, choice, event, note, skip, step_end).
Este script cruza as duas coisas e mostra, para cada passo:
- liga/desliga (pattern): os bits que acompanham todas as vezes "liga" e "desliga";
- fases (phases): a média dos bytes que mais mudam entre as fases;
- eventos (events): os bits que mudam em volta de cada toque no botão.

Só lê o arquivo. Uso:
    python3 tools/can-capture/roteiro_app.py diag_....jsonl.gz [--passo door_driver]
"""
import argparse
import gzip
import json
import sys
from collections import defaultdict

# Tempo para a pessoa reagir à voz: o começo de cada janela fica de fora.
REACT_S = 1.5
# Fração mínima de quadros com o bit no valor da ação, em toda janela "liga" (e o contrário em toda "desliga")
MAJORITY = 0.6
EVENT_WINDOW_S = 4.0


def open_text(path):
    return gzip.open(path, "rt", encoding="utf-8") if path.endswith(".gz") else open(path, encoding="utf-8")


def parse_frame(line):
    """Linha slcan "tIIIL..." ou "TIIIIIIIIL..." → (id, bytes). None se não for quadro de dados."""
    try:
        if line.startswith("t"):
            fid, n, data = int(line[1:4], 16), int(line[4]), line[5:]
        elif line.startswith("T"):
            fid, n, data = int(line[1:9], 16), int(line[9]), line[10:]
        else:
            return None
        payload = bytes.fromhex(data[: 2 * n])
        return (fid, payload) if len(payload) == n else None
    except ValueError:
        return None


def load(path):
    frames, marks = [], []
    with open_text(path) as fh:
        for raw in fh:
            try:
                o = json.loads(raw)
            except ValueError:
                continue
            if o.get("type") == "esp32":
                f = parse_frame(o.get("l", ""))
                if f:
                    frames.append((o["t"] / 1000.0, f[0], f[1]))
            elif o.get("type") == "mark":
                marks.append(dict(o, t=o["t"] / 1000.0))
    frames.sort(key=lambda x: x[0])
    return frames, marks


def steps_from_marks(marks):
    """Agrupa as marcas em execuções de passo (step_start → step_end). Notas e pulos ficam à parte."""
    runs, current, extras = [], None, []
    for m in marks:
        ph = m.get("phase")
        if ph == "step_start":
            current = {"step": m["step"], "label": m.get("label", m["step"]), "start": m["t"], "marks": [], "result": None}
        elif ph in ("note", "skip"):
            extras.append(m)
        elif current and m.get("step") == current["step"]:
            if ph == "step_end":
                current["end"], current["result"] = m["t"], m.get("result")
                runs.append(current)
                current = None
            else:
                current["marks"].append(m)
    return runs, extras


def frames_between(frames, t0, t1):
    return [f for f in frames if t0 <= f[0] < t1]


def bit_majority(fr):
    """{(id, byte, bit): fração de quadros com o bit em 1} numa janela."""
    count, ones = defaultdict(int), defaultdict(int)
    for _, fid, data in fr:
        for b, v in enumerate(data):
            for bit in range(8):
                count[(fid, b, bit)] += 1
                if v >> bit & 1:
                    ones[(fid, b, bit)] += 1
    return {k: ones[k] / n for k, n in count.items()}


def pattern_windows(run, frames):
    """Janelas "liga" e "desliga": de cada marca on/off até a próxima marca (ou o fim do passo)."""
    seq = [m for m in run["marks"] if m.get("phase") in ("on", "off")]
    ends = [m["t"] for m in seq[1:]] + [run.get("end", seq[-1]["t"] if seq else run["start"])]
    out = {"on": [], "off": []}
    for m, t1 in zip(seq, ends):
        t0 = m["t"] + REACT_S
        if t1 > t0:
            out[m["phase"]].append(frames_between(frames, t0, t1))
    return out


def analyze_pattern(run, frames):
    """Bits que ficam, na maior parte de cada janela "liga", num valor, e no outro em cada janela "desliga"."""
    win = pattern_windows(run, frames)
    if not win["on"] or not win["off"]:
        return []
    per = {k: [bit_majority(w) for w in ws if w] for k, ws in win.items()}
    if not per["on"] or not per["off"]:
        return []
    keys = set.intersection(*(set(m) for m in per["on"] + per["off"]))
    found = []
    for k in keys:
        on = [m[k] for m in per["on"]]
        off = [m[k] for m in per["off"]]
        # Maioria em cada janela: a pessoa pode demorar alguns segundos a mais que REACT_S para agir
        if min(on) >= MAJORITY and max(off) <= 1 - MAJORITY:
            found.append((k, 1, sum(on) / len(on), sum(off) / len(off)))
        elif max(on) <= 1 - MAJORITY and min(off) >= MAJORITY:
            found.append((k, 0, sum(on) / len(on), sum(off) / len(off)))
    return sorted(found)


def analyze_phases(run, frames, top=6):
    """Média de cada byte por fase; mostra os que mais mudam entre fases."""
    seq = [m for m in run["marks"] if m.get("phase") == "phase"]
    ends = [m["t"] for m in seq[1:]] + [run.get("end", seq[-1]["t"] if seq else run["start"])]
    rows = []
    for m, t1 in zip(seq, ends):
        sums, cnt = defaultdict(float), defaultdict(int)
        for _, fid, data in frames_between(frames, m["t"] + REACT_S, t1):
            for b, v in enumerate(data):
                sums[(fid, b)] += v
                cnt[(fid, b)] += 1
        rows.append((m.get("label", ""), {k: sums[k] / cnt[k] for k in cnt}))
    if len(rows) < 2:
        return rows, []
    keys = set.intersection(*(set(r[1]) for r in rows))
    spread = sorted(keys, key=lambda k: -(max(r[1][k] for r in rows) - min(r[1][k] for r in rows)))
    return rows, [k for k in spread[:top] if max(r[1][k] for r in rows) - min(r[1][k] for r in rows) >= 1]


def analyze_events(run, frames):
    """Para cada toque: bits que estavam num valor antes e no outro depois."""
    out = []
    for m in run["marks"]:
        if m.get("phase") != "event":
            continue
        before = bit_majority(frames_between(frames, m["t"] - EVENT_WINDOW_S, m["t"] - 0.5))
        after = bit_majority(frames_between(frames, m["t"] + 0.5, m["t"] + EVENT_WINDOW_S))
        flips = sorted(k for k in set(before) & set(after) if abs(before[k] - after[k]) >= 0.9)
        out.append((m, flips))
    return out


def fmt_bit(k):
    fid, b, bit = k
    return f"0x{fid:03X} b{b} bit {bit}"


def report(path, only=None, out=sys.stdout):
    frames, marks = load(path)
    runs, extras = steps_from_marks(marks)
    print(f"{len(frames)} quadros do ESP32, {len(marks)} marcas, {len(runs)} passos executados.", file=out)
    if not frames:
        print("Sem quadros do ESP32: a escuta CAN estava ligada nesta captura?", file=out)
    for run in runs:
        if only and run["step"] != only:
            continue
        kinds = {m.get("phase") for m in run["marks"]}
        print(f"\n== {run['label']} ({run['step']}) · resultado: {run['result']}", file=out)
        for c in (m for m in run["marks"] if m.get("phase") == "choice"):
            print(f"   escolha: {c.get('label', '')} = {c.get('value', '')}", file=out)
        if kinds & {"on", "off"}:
            found = analyze_pattern(run, frames)
            if not found:
                print("   nenhum bit acompanhou todas as vezes liga/desliga", file=out)
            for k, v, p_on, p_off in found:
                print(f"   {fmt_bit(k)} = {v} com a ação (liga {p_on:.0%} · desliga {p_off:.0%})", file=out)
        elif "event" in kinds:
            for m, flips in analyze_events(run, frames):
                desc = ", ".join(fmt_bit(k) for k in flips[:8]) or "nenhum bit mudou"
                print(f"   {m.get('label', '')} {m.get('value', '')}: {desc}", file=out)
        elif "phase" in kinds:
            rows, keys = analyze_phases(run, frames)
            if keys:
                head = " | ".join(f"0x{fid:03X} b{b}" for fid, b in keys)
                print(f"   fase | {head}", file=out)
                for label, means in rows:
                    print(f"   {label} | " + " | ".join(f"{means[k]:.0f}" for k in keys), file=out)
            else:
                print("   nenhum byte mudou entre as fases", file=out)
    for m in extras:
        if only and m.get("step") != only:
            continue
        kind = "observação" if m.get("phase") == "note" else "pulado"
        print(f"\n-- {m.get('step')}: {kind} {m.get('note', '')}".rstrip(), file=out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("arquivo", help="diag_….jsonl.gz exportado pelo app")
    p.add_argument("--passo", help="só este passo (id do roteiro)")
    a = p.parse_args(argv)
    report(a.arquivo, a.passo)


if __name__ == "__main__":
    main()
