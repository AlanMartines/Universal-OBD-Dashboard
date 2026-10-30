#!/usr/bin/env python3
"""Grava e analisa a escuta passiva da rede CAN (firmware/arduino-can-listen).

O adaptador manda uma linha slcan por quadro (t/T/r/R) e linhas de estado começadas por '#'.
A gravação guarda cada linha com o horário do computador em milissegundos: "1700000000123 t1238AABB...".

Uso:
  # Grava pela USB. Tecle Enter (com um texto opcional) para marcar um evento: "seta esquerda", "porta"...
  python3 tools/can-capture/can_capture.py gravar /dev/ttyACM0 -o captura.log [--segundos 120]

  # Um ID por linha: quantidade, frequência, tamanho e quais bytes mudam
  python3 tools/can-capture/can_capture.py resumo captura.log

  # Antes/depois em dois arquivos: IDs que surgem ou somem e bytes com valores diferentes
  python3 tools/can-capture/can_capture.py comparar antes.log depois.log

  # Bytes que mudaram logo depois de cada marca, comparados com os segundos anteriores
  python3 tools/can-capture/can_capture.py marcas captura.log [--janela 2]

Para a sessão completa no carro, guiada passo a passo (tensões, ações, hodômetro), use o roteiro.py.

Só usa a biblioteca padrão do Python 3. A gravação pela USB funciona no Linux e no macOS.
"""
import argparse
import os
import select
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Frame:
    t_ms: int
    can_id: int
    extended: bool
    rtr: bool
    data: bytes

    @property
    def key(self):
        return f"{self.can_id:08X}" if self.extended else f"{self.can_id:03X}"


@dataclass(frozen=True)
class Mark:
    t_ms: int
    label: str


@dataclass
class Capture:
    frames: list = field(default_factory=list)
    marks: list = field(default_factory=list)
    status: list = field(default_factory=list)


def parse_slcan(text, t_ms=0):
    """Um quadro slcan ("t1238AABB…", "T12345678200FF", "r1230"); None se a linha não for um quadro."""
    if not text or text[0] not in "tTrR":
        return None
    extended = text[0] in "TR"
    rtr = text[0] in "rR"
    id_len = 8 if extended else 3
    try:
        can_id = int(text[1:1 + id_len], 16)
        length = int(text[1 + id_len], 16)
        payload = text[2 + id_len:]
        data = b"" if rtr else bytes.fromhex(payload[:2 * length])
        tail = payload[0 if rtr else 2 * length:]
        if tail:
            int(tail, 16)                                 # carimbo de tempo opcional do slcan (4 hex)
    except (ValueError, IndexError):
        return None
    if len(tail) not in (0, 4) or length > 8 or len(data) != (0 if rtr else length) or can_id > (0x1FFFFFFF if extended else 0x7FF):
        return None
    return Frame(t_ms, can_id, extended, rtr, data)


def parse_lines(lines):
    """Lê uma gravação. Aceita linhas com o horário na frente ("<ms> <slcan>") ou só o slcan."""
    cap = Capture()
    for n, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        t_ms = n
        head, _, rest = line.partition(" ")
        if head.isdigit() and rest:
            t_ms, line = int(head), rest.strip()
        if line.startswith("# MARCA"):
            cap.marks.append(Mark(t_ms, line[len("# MARCA"):].strip()))
        elif line.startswith("#"):
            cap.status.append((t_ms, line[1:].strip()))
        else:
            frame = parse_slcan(line, t_ms)
            if frame:
                cap.frames.append(frame)
    return cap


def load(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return parse_lines(fh)


def summarize(frames):
    """Por ID: quantidade, frequência (Hz), tamanhos vistos e, para cada byte, o conjunto de valores."""
    by_id = defaultdict(list)
    for f in frames:
        by_id[f.key].append(f)
    out = {}
    for key, fs in sorted(by_id.items()):
        span_s = (fs[-1].t_ms - fs[0].t_ms) / 1000
        values = defaultdict(set)
        for f in fs:
            for i, b in enumerate(f.data):
                values[i].add(b)
        out[key] = {
            "count": len(fs),
            "hz": (len(fs) - 1) / span_s if span_s > 0 else None,
            "lengths": sorted({len(f.data) for f in fs}),
            "values": {i: sorted(v) for i, v in sorted(values.items())},
            "last": fs[-1].data,
        }
    return out


def byte_values(frames):
    """{(ID, posição do byte): conjunto de valores}."""
    seen = defaultdict(set)
    for f in frames:
        for i, b in enumerate(f.data):
            seen[(f.key, i)].add(b)
    return seen


def compare(before, after):
    """IDs que só aparecem num lado e bytes cujos valores do 'depois' não apareceram no 'antes'."""
    ids_a = {f.key for f in before}
    ids_b = {f.key for f in after}
    va, vb = byte_values(before), byte_values(after)
    changed = []
    for (key, i), values in sorted(vb.items()):
        if key in ids_a and (key, i) in va and values != va[(key, i)]:
            changed.append((key, i, sorted(va[(key, i)]), sorted(values)))
    return sorted(ids_b - ids_a), sorted(ids_a - ids_b), changed


def around_marks(cap, window_s=2.0):
    """Para cada marca: comparação entre os `window_s` segundos antes e depois dela."""
    w = int(window_s * 1000)
    result = []
    for mark in cap.marks:
        before = [f for f in cap.frames if mark.t_ms - w <= f.t_ms < mark.t_ms]
        after = [f for f in cap.frames if mark.t_ms <= f.t_ms < mark.t_ms + w]
        result.append((mark, compare(before, after)))
    return result


def hexs(values, limit=8):
    shown = " ".join(f"{v:02X}" for v in values[:limit])
    return shown + (f" …(+{len(values) - limit})" if len(values) > limit else "")


def print_changes(new_ids, gone_ids, changed, out):
    if new_ids:
        print(f"  IDs novos: {' '.join(new_ids)}", file=out)
    if gone_ids:
        print(f"  IDs que sumiram: {' '.join(gone_ids)}", file=out)
    for key, i, va, vb in changed:
        print(f"  {key} byte {i}: {hexs(va)}  →  {hexs(vb)}", file=out)
    if not (new_ids or gone_ids or changed):
        print("  nenhuma diferença", file=out)


def cmd_resumo(args, out=sys.stdout):
    cap = load(args.arquivo)
    for t, s in cap.status:
        if "listen-only" in s or "ERRO" in s or "fixada" in s:
            print(f"# {s}", file=out)
    print(f"{len(cap.frames)} quadros, {len(cap.marks)} marcas", file=out)
    print(f"{'ID':>8}  {'qtd':>6}  {'Hz':>6}  tam  bytes que mudam (valores distintos)", file=out)
    for key, s in summarize(cap.frames).items():
        hz = f"{s['hz']:.1f}" if s["hz"] is not None else "-"
        varying = [f"b{i}:{len(v)}" for i, v in s["values"].items() if len(v) > 1]
        sizes = ",".join(map(str, s["lengths"]))
        print(f"{key:>8}  {s['count']:>6}  {hz:>6}  {sizes:>3}  {' '.join(varying) or 'fixo'}"
              f"   último: {s['last'].hex(' ').upper()}", file=out)


def cmd_comparar(args, out=sys.stdout):
    a, b = load(args.antes), load(args.depois)
    print(f"antes: {len(a.frames)} quadros; depois: {len(b.frames)} quadros", file=out)
    print_changes(*compare(a.frames, b.frames), out)


def cmd_marcas(args, out=sys.stdout):
    cap = load(args.arquivo)
    if not cap.marks:
        print("Nenhuma marca na gravação (tecle Enter durante o 'gravar').", file=out)
    for mark, changes in around_marks(cap, args.janela):
        print(f"MARCA {mark.label or '(sem nome)'} @ {mark.t_ms}", file=out)
        print_changes(*changes, out)


def open_serial(port, baud):
    import termios
    fd = os.open(port, os.O_RDONLY | os.O_NOCTTY)
    attrs = termios.tcgetattr(fd)
    speed = getattr(termios, f"B{baud}")
    attrs[0] = 0                                      # iflag: sem tradução de entrada
    attrs[1] = 0                                      # oflag
    attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    attrs[3] = 0                                      # lflag: modo bruto
    attrs[4] = attrs[5] = speed
    attrs[6][termios.VMIN] = 0
    attrs[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIFLUSH)             # descarta o que ficou acumulado na porta antes de abrir
    return fd


def write_serial_lines(buf, chunk, fh, now):
    """Junta [chunk] ao que sobrou em [buf] e grava as linhas completas com o horário [now] na frente.
    Devolve (sobra, quadros válidos gravados, linhas de estado '#'). Linha corrompida é gravada, mas não conta."""
    *lines, rest = (buf + chunk).split(b"\n")
    frames, status = 0, []
    for raw in lines:
        line = raw.decode("ascii", "replace").strip()
        if not line:
            continue
        fh.write(f"{now} {line}\n")
        if line.startswith("#"):
            status.append(line)
        elif parse_slcan(line):
            frames += 1
    fh.flush()
    return rest, frames, status


def cmd_gravar(args):
    # Só lê a porta: a ferramenta nunca escreve no adaptador.
    fd = open_serial(args.porta, args.baud)
    deadline = time.monotonic() + args.segundos if args.segundos else None
    buf = b""
    frames = marks = 0
    watch = [fd, sys.stdin]
    print("Gravando. Enter (com texto opcional) marca um evento; Ctrl+C encerra.", file=sys.stderr)
    with open(args.saida, "a", encoding="utf-8") as fh:
        try:
            while deadline is None or time.monotonic() < deadline:
                ready, _, _ = select.select(watch, [], [], 0.2)
                now = int(time.time() * 1000)
                if sys.stdin in ready:
                    entry = sys.stdin.readline()
                    if not entry:                         # entrada fechada: segue gravando sem marcas
                        watch.remove(sys.stdin)
                        continue
                    label = entry.strip()
                    marks += 1
                    fh.write(f"{now} # MARCA {label or marks}\n")
                    print(f"marca {marks}: {label or marks}", file=sys.stderr)
                if fd in ready:
                    buf, n, status = write_serial_lines(buf, os.read(fd, 4096), fh, now)
                    frames += n
                    for line in status:
                        print(line, file=sys.stderr)
        except KeyboardInterrupt:
            pass
        finally:
            os.close(fd)
    print(f"{frames} quadros e {marks} marcas em {args.saida}", file=sys.stderr)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gravar", help="grava a escuta pela USB")
    g.add_argument("porta")
    g.add_argument("-o", "--saida", required=True)
    g.add_argument("--segundos", type=float)
    g.add_argument("--baud", type=int, default=500000)
    r = sub.add_parser("resumo", help="resumo por ID")
    r.add_argument("arquivo")
    c = sub.add_parser("comparar", help="antes/depois em dois arquivos")
    c.add_argument("antes")
    c.add_argument("depois")
    m = sub.add_parser("marcas", help="o que muda em volta de cada marca")
    m.add_argument("arquivo")
    m.add_argument("--janela", type=float, default=2.0, help="segundos antes e depois de cada marca")
    args = p.parse_args(argv)
    {"gravar": cmd_gravar, "resumo": cmd_resumo, "comparar": cmd_comparar, "marcas": cmd_marcas}[args.cmd](args)


if __name__ == "__main__":
    main()
