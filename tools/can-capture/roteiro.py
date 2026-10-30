#!/usr/bin/env python3
"""Sessão de escuta CAN guiada passo a passo, no carro (firmware/arduino-can-listen).

Um menu leva por cada etapa de docs/can-escuta.md, na ordem, ou deixa escolher uma etapa solta:
conferência do cabo, tensões dos pinos 6/14, montagem, teste de recepção, ações (setas, portas,
faróis…), hodômetro antes/depois de uma volta e desmontagem. Cada ação vira uma marca com nome
fixo na gravação, no momento do Enter. Tudo vai para uma pasta: os .log de cada gravação e o
anotacoes.txt com as tensões, os valores do painel e o que foi pulado ou refeito.

Uso:
  python3 tools/can-capture/roteiro.py /dev/ttyACM0 --pasta ~/captura-can

Como o can_capture.py, só lê a porta USB: nunca escreve no adaptador. Funciona no Linux e no macOS.
"""
import argparse
import os
import select
import sys
import threading
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import can_capture as cc  # noqa: E402

MIN_GAP_S = 3.0          # entre duas marcas: o carro precisa de tempo para reagir e transmitir
SILENCE_S = 5.0          # sem quadros há mais que isso: avisa
RECEPTION_S = 15
ODOMETER_S = 120

# (nome, [(instrução, marca)]). A marca é o texto que vai para a gravação; manter fixo entre sessões.
ACTIONS = [
    ("Repouso (base)", [("Não mexa em nada por 10 s", ("repouso", 10))]),
    ("Seta esquerda", [("Ligue a seta esquerda", "seta esq liga"), ("Desligue a seta esquerda", "seta esq desliga")]),
    ("Seta direita", [("Ligue a seta direita", "seta dir liga"), ("Desligue a seta direita", "seta dir desliga")]),
    ("Pisca-alerta", [("Ligue o pisca-alerta", "alerta liga"), ("Desligue o pisca-alerta", "alerta desliga")]),
    ("Porta do motorista", [("Abra a porta do motorista", "porta mot abre"), ("Feche a porta do motorista", "porta mot fecha")]),
    ("Porta do passageiro", [("Abra a porta do passageiro", "porta pass abre"), ("Feche a porta do passageiro", "porta pass fecha")]),
    ("Farol baixo", [("Ligue o farol baixo", "farol baixo liga"), ("Desligue o farol baixo", "farol baixo desliga")]),
    ("Farol alto", [("Ligue o farol alto", "farol alto liga"), ("Desligue o farol alto", "farol alto desliga")]),
    ("Lanterna", [("Ligue a lanterna", "lanterna liga"), ("Desligue a lanterna", "lanterna desliga")]),
    ("Freio de mão", [("Puxe o freio de mão", "freio mao puxa"), ("Solte o freio de mão", "freio mao solta")]),
    ("Pedal de freio", [("Pise no pedal de freio", "freio pedal pisa"), ("Solte o pedal de freio", "freio pedal solta")]),
    ("Cinto do motorista", [("Afivele o cinto do motorista", "cinto mot coloca"), ("Solte o cinto do motorista", "cinto mot tira")]),
    ("Partida do motor", [("Dê a partida no motor", "partida"), ("Motor funcionando há uns 10 s, sem mexer em nada", "motor estavel")]),
]

CABLE_CHECKS = [
    "Pino 5 do conector chega ao fio do terra (continuidade)",
    "Pino 6 do conector chega ao fio do CAN-H (continuidade)",
    "Pino 14 do conector chega ao fio do CAN-L (continuidade)",
]

VOLTAGE_SITUATIONS = [
    ("A", "Ignição desligada, portas fechadas"),
    ("B", "Ignição desligada, porta do motorista aberta"),
    ("C", "Ignição ligada, motor desligado"),
    ("D", "Motor ligado"),
]

ASSEMBLY_CHECKS = [
    "Nada mais ligado ao carro (carregador de bateria, mantenedor)",
    "Notebook: carregador na tomada da casa (extensão), nunca em inversor do carro",
    "Jumper de 120 Ω do MCP2515 retirado",
    "Pino 6 → CANH, pino 14 → CANL, pino 5 → GND livre do Arduino",
    "Pino 16 (+12 V) NÃO ligado",
    "Por último: USB do Arduino no notebook",
]

DISASSEMBLY_CHECKS = ["USB desconectado", "Fios retirados do conector OBD", "Carro desligado"]


def parse_volts(text):
    """'4,8' ou '4.8' → 4.8; None se não for número."""
    try:
        return float(text.strip().replace(",", "."))
    except ValueError:
        return None


def classify_voltages(pin6, pin14):
    """O que as tensões em relação ao pino 5 indicam (docs/can-escuta.md)."""
    if max(pin6, pin14) < 0.3:
        return "rede dormindo ou fio sem ligação"
    if abs(pin6 - 2.5) < 0.7 and abs(pin14 - 2.5) < 0.7:
        return "CAN de alta velocidade (ISO 11898-2)"
    # Tolerante a falhas: em repouso o CAN-H (6) fica perto de 0 V e o CAN-L (14) perto de 5 V.
    # Dormindo, a terminação puxa o CAN-L até a tensão da bateria.
    if pin6 < 1.5 and 3.5 < pin14 < 6:
        return "CAN tolerante a falhas (ISO 11898-3), típica da carroceria"
    if pin6 < 1.5 and 8 < pin14 < 16:
        return "CAN tolerante a falhas dormindo (CAN-L na tensão da bateria): ligue a ignição para acordar"
    if pin14 < 1.5 and pin6 > 3.5:
        return "invertido: confira se as pontas estão mesmo nos pinos 6 e 14"
    return "fora do esperado: confira as pontas e o pino 5"


def unique_path(folder, name):
    """captura.log; se já existir, captura_2.log, captura_3.log… (nunca grava por cima)."""
    base, ext = os.path.splitext(name)
    path, n = os.path.join(folder, name), 2
    while os.path.exists(path):
        path, n = os.path.join(folder, f"{base}_{n}{ext}"), n + 1
    return path


class Recorder:
    """Grava a porta numa thread, como o 'gravar' do can_capture.py; [mark] põe marcas no mesmo arquivo."""

    def __init__(self, port, path, baud=500000, show=print):
        self.port, self.path, self.baud, self.show = port, path, baud, show
        self.frames = 0
        self.last_frame = None
        self._lock = threading.Lock()
        self._stop = threading.Event()

    def start(self):
        self._fd = cc.open_serial(self.port, self.baud)
        self._fh = open(self.path, "a", encoding="utf-8")
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self):
        buf = b""
        while not self._stop.is_set():
            ready, _, _ = select.select([self._fd], [], [], 0.2)
            if not ready:
                continue
            chunk = os.read(self._fd, 4096)
            with self._lock:
                buf, n, status = cc.write_serial_lines(buf, chunk, self._fh, int(time.time() * 1000))
            if n:
                self.frames += n
                self.last_frame = time.monotonic()
            for line in status:
                self.show(f"   {line}")

    def silent_for(self):
        """Segundos sem quadro (desde o início, se nenhum chegou)."""
        return time.monotonic() - (self.last_frame or self._started)

    def mark(self, label):
        with self._lock:
            self._fh.write(f"{int(time.time() * 1000)} # MARCA {label}\n")
            self._fh.flush()

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=2)
        os.close(self._fd)
        self._fh.close()
        return self.frames


class Session:
    """As etapas do roteiro. [ask], [out], [clock], [sleep] e [recorder] são trocáveis nos testes."""

    def __init__(self, port, folder, ask=input, out=print, clock=time.monotonic, sleep=time.sleep, recorder=Recorder):
        self.port, self.folder = port, folder
        self.ask, self.out, self.clock, self.sleep, self.recorder = ask, out, clock, sleep, recorder
        self.notes_path = os.path.join(folder, "anotacoes.txt")
        self.done = set()

    # --- utilitários ---

    def note(self, text):
        with open(self.notes_path, "a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {text}\n")

    def checklist(self, title, items):
        """Enter confirma cada item; 'n' registra o problema. Devolve True se tudo foi confirmado."""
        self.out(f"\n== {title} ==  (Enter = ok, n = não está ok)")
        ok = True
        for item in items:
            if self.ask(f"  [ ] {item}: ").strip().lower() == "n":
                ok = False
                self.note(f"{title}: NÃO OK: {item}")
                self.out("      ⚠ anotado. Corrija antes de seguir.")
        if ok:
            self.note(f"{title}: ok")
        return ok

    def ask_number(self, prompt):
        while True:
            answer = self.ask(prompt).strip()
            if answer == "":
                return None
            v = parse_volts(answer)
            if v is not None:
                return v
            self.out("      Digite só o número (ex.: 4,8) ou Enter para deixar em branco.")

    def port_ready(self):
        while not (os.path.exists(self.port) and os.access(self.port, os.R_OK)):
            self.out(f"\n⚠ A porta {self.port} não está disponível.")
            self.out("  Confira o USB. Para achar a porta: ls /dev/ttyACM* /dev/ttyUSB*")
            self.out(f"  Para liberar a leitura: sudo chmod a+rw {self.port}")
            if self.ask("  Enter tenta de novo, s cancela: ").strip().lower() == "s":
                return False
        return True

    def timed_recording(self, name, seconds, title):
        """Grava [seconds] s em [name] mostrando a contagem. Devolve (caminho, quadros) ou None."""
        if not self.port_ready():
            return None
        path = unique_path(self.folder, name)
        rec = self.recorder(self.port, path, show=self.out).start()
        self.out(f"   Gravando {title} em {path} ({seconds} s)…")
        try:
            for left in range(seconds, 0, -1):
                if left % 10 == 0 or left <= 3:
                    self.out(f"   … {left} s  (quadros: {rec.frames})")
                self.sleep(1)
        finally:
            frames = rec.stop()
        self.out(f"   ✓ {frames} quadros em {path}")
        self.note(f"{title}: {frames} quadros em {os.path.basename(path)}")
        return path, frames

    # --- etapas ---

    def step_cable(self):
        self.out("\nMultímetro em continuidade, cabo fora do carro.")
        self.checklist("Conferência do cabo", CABLE_CHECKS)

    def step_voltages(self):
        self.out("\n== Tensões ==  Arduino DESCONECTADO do carro. Multímetro em DC 20 V,")
        self.out("   ponta preta no pino 5 (nunca no 4), vermelha no 6 e depois no 14. Enter em branco pula.")
        for code, situation in VOLTAGE_SITUATIONS:
            self.ask(f"\n  {code}. {situation}. Deixe o carro assim e tecle Enter… ")
            v6 = self.ask_number("     Pino 6 (V): ")
            v14 = self.ask_number("     Pino 14 (V): ")
            if v6 is None or v14 is None:
                self.note(f"tensão {code} ({situation}): não medida")
                continue
            verdict = classify_voltages(v6, v14)
            self.out(f"     → {verdict}")
            self.note(f"tensão {code} ({situation}): pino 6 = {v6:.2f} V, pino 14 = {v14:.2f} V → {verdict}")

    def step_assembly(self):
        self.checklist("Montagem", ASSEMBLY_CHECKS)

    def step_reception(self):
        self.out("\n== Teste de recepção ==  Ligue a ignição, sem dar partida.")
        while True:
            self.ask("   Ignição ligada? Enter para gravar 15 s… ")
            result = self.timed_recording("teste.log", RECEPTION_S, "teste de recepção")
            if result is None:
                return False
            path, _ = result
            cap = cc.load(path)
            for _, s in cap.status:
                if "listen-only" in s or "ERRO" in s:
                    self.out(f"   # {s}")
            ids = len({f.key for f in cap.frames})
            if cap.frames:
                self.out(f"   ✓ Recepção ok: {len(cap.frames)} quadros de {ids} IDs diferentes.")
                return True
            self.out("   ⚠ Nenhum quadro. Abra e feche uma porta para acordar a rede.")
            self.out("     Se aparecer '# ERRO', confira os fios entre o Arduino e o módulo.")
            if self.ask("   Enter repete o teste, p segue mesmo assim: ").strip().lower() == "p":
                self.note("teste de recepção: seguiu sem quadros")
                return False

    def run_action(self, rec, name, stages, last_mark):
        """Uma ação, etapa por etapa. Devolve ('ok' | 'pulado' | 'parar', horário da última marca)."""
        self.out(f"\n▶ {name}")
        i = 0
        marked = False
        while i < len(stages):
            instruction, label = stages[i]
            if isinstance(label, tuple):                       # etapa cronometrada
                label, seconds = label
                self.ask(f"  [{i + 1}/{len(stages)}] {instruction}. Enter começa… ")
                rec.mark(f"{label} inicio")
                self.sleep(seconds)
                rec.mark(f"{label} fim")
                last_mark, marked = self.clock(), True
                self.out(f"      ✓ marcas '{label} inicio' e '{label} fim'")
                i += 1
                continue
            answer = self.ask(
                f"  [{i + 1}/{len(stages)}] {instruction}: Enter NO MOMENTO da ação (r refaz, p pula, s para): "
            ).strip().lower()
            if answer in ("p", "s"):
                if marked:
                    rec.mark(f"cancelado {name}")
                self.note(f"ação '{name}': {'pulada' if answer == 'p' else 'interrompida'}")
                return ("pulado" if answer == "p" else "parar"), last_mark
            if answer == "r":
                if marked:
                    rec.mark(f"refazer {name}")
                    self.note(f"ação '{name}': refeita")
                self.out("      ↺ recomeçando esta ação")
                i, marked = 0, False
                continue
            if answer:
                self.out("      Só Enter, r, p ou s.")
                continue
            gap = self.clock() - last_mark if last_mark is not None else None
            if gap is not None and gap < MIN_GAP_S:
                self.out(f"      ⏳ Cedo demais ({gap:.1f} s desde a última). Espere o carro reagir e tecle Enter de novo.")
                continue
            rec.mark(label)
            last_mark, marked = self.clock(), True
            self.out(f"      ✓ marca '{label}'  (quadros: {rec.frames})")
            if rec.silent_for() > SILENCE_S:
                self.out(f"      ⚠ nenhum quadro há {rec.silent_for():.0f} s: a rede pode ter dormido ou um fio soltou.")
            i += 1
        self.done.add(name)
        return "ok", last_mark

    def step_actions(self, only=None):
        """Todas as ações em sequência ou só [only] (índices de ACTIONS). Uma gravação por chamada."""
        chosen = [ACTIONS[i] for i in only] if only is not None else ACTIONS
        if only is None:
            self.out("\n== Ações ==  Ignição ligada, motor DESLIGADO (a partida é a última).")
            self.out("   Para cada etapa: faça a ação e tecle Enter no mesmo instante. Espere uns 5 s entre elas.")
        if not self.port_ready():
            return
        path = unique_path(self.folder, "acoes.log")
        rec = self.recorder(self.port, path, show=self.out).start()
        self.out(f"   Gravando em {path}. Aguarde 3 s…")
        self.sleep(3)
        last_mark = None
        try:
            for n, (name, stages) in enumerate(chosen):
                if only is None and n > 0:
                    answer = self.ask(f"\n  Próximo: {name}. Enter começa, p pula, s para: ").strip().lower()
                    if answer == "p":
                        self.note(f"ação '{name}': pulada")
                        continue
                    if answer == "s":
                        break
                status, last_mark = self.run_action(rec, name, stages, last_mark)
                if status == "parar":
                    break
            if only is None or last_mark is not None:
                self.sleep(2)                                  # deixa gravar a reação à última ação
        finally:
            frames = rec.stop()
        self.out(f"   ✓ {frames} quadros em {path}")
        self.note(f"ações {[name for name, _ in chosen] if only is not None else '(sequência)'}: "
                  f"{frames} quadros em {os.path.basename(path)}")

    def step_odometer(self, moment):
        """moment: 'antes' ou 'depois'."""
        self.out(f"\n== Hodômetro: {moment} ==")
        self.checklist("Condições", [
            "Motor ligado, carro parado",
            "Faróis, setas e lanterna desligados; portas fechadas",
            "Ninguém mexe em nada durante os 2 minutos",
        ])
        total = self.ask(f"   Hodômetro TOTAL no painel ({moment}), km: ").strip()
        trip = self.ask(f"   Hodômetro PARCIAL (trip) ({moment}), km: ").strip()
        tank = self.ask(f"   Ponteiro do tanque ({moment}), ex.: 1/2: ").strip()
        self.note(f"hodômetro {moment}: total = {total or '?'} km, parcial = {trip or '?'} km, tanque = {tank or '?'}")
        self.ask("   Enter para gravar 2 minutos… ")
        self.timed_recording(f"odo_{moment}.log", ODOMETER_S, f"hodômetro {moment}")

    def step_drive(self):
        self.out("\n== A volta ==")
        self.out("   1. Desconecte o USB e tire os fios do OBD (não ande com a montagem pendurada).")
        self.out("   2. Rode até o hodômetro TOTAL avançar pelo menos 1 km (melhor 2).")
        self.out("   3. Volte, religue os fios no OBD e, por último, o USB.")
        self.ask("   Quando tudo estiver religado, tecle Enter… ")
        self.note("volta: concluída")

    def step_disassembly(self):
        self.checklist("Desmontagem", DISASSEMBLY_CHECKS)

    def finish(self):
        self.out(f"\nPronto. Tudo está em {self.folder}:")
        for name in sorted(os.listdir(self.folder)):
            self.out(f"   {name}")
        self.out("Copie a pasta para /root/Projetos/DadosViagem/CAN/ e avise.")

    def run_all(self):
        self.step_cable()
        self.step_voltages()
        self.step_assembly()
        self.step_reception()
        self.step_actions()
        self.step_odometer("antes")
        self.step_drive()
        self.step_odometer("depois")
        self.step_disassembly()
        self.finish()

    def actions_menu(self):
        while True:
            self.out("\n-- Ações avulsas (cada escolha grava um arquivo acoes_N.log) --")
            for n, (name, _) in enumerate(ACTIONS, 1):
                self.out(f"  {n:>2}  {'✓' if name in self.done else ' '} {name}")
            answer = self.ask("  Número da ação, ou Enter para voltar: ").strip()
            if not answer:
                return
            if answer.isdigit() and 1 <= int(answer) <= len(ACTIONS):
                self.step_actions(only=[int(answer) - 1])
            else:
                self.out("  Opção inválida.")

    def menu(self):
        options = {
            "1": ("Conferir o cabo (multímetro)", self.step_cable),
            "2": ("Medir as tensões dos pinos 6 e 14", self.step_voltages),
            "3": ("Montagem", self.step_assembly),
            "4": ("Teste de recepção (15 s)", self.step_reception),
            "5": ("Ações: sequência completa", self.step_actions),
            "6": ("Ações: escolher uma", self.actions_menu),
            "7": ("Hodômetro: antes da volta", lambda: self.step_odometer("antes")),
            "8": ("A volta (instruções)", self.step_drive),
            "9": ("Hodômetro: depois da volta", lambda: self.step_odometer("depois")),
            "10": ("Desmontagem", self.step_disassembly),
            "a": ("TUDO em sequência (1 a 10)", self.run_all),
        }
        while True:
            self.out(f"\n===== Escuta CAN — porta {self.port}, pasta {self.folder} =====")
            for key, (label, _) in options.items():
                self.out(f"  {key.upper():>2}  {label}")
            self.out("   S  Sair")
            answer = self.ask("Escolha: ").strip().lower()
            if answer == "s":
                self.finish()
                return
            if answer in options:
                options[answer][1]()
            else:
                self.out("Opção inválida.")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("porta", help="porta do Arduino, ex.: /dev/ttyACM0 ou /dev/ttyUSB0")
    p.add_argument("--pasta", default=os.path.expanduser("~/captura-can"), help="onde salvar (padrão: ~/captura-can)")
    args = p.parse_args(argv)
    os.makedirs(args.pasta, exist_ok=True)
    session = Session(args.porta, args.pasta)
    session.note(f"sessão iniciada (porta {args.porta})")
    try:
        session.menu()
    except (KeyboardInterrupt, EOFError):
        session.note("sessão encerrada com Ctrl+C")
        print("\nEncerrado. As gravações feitas até aqui estão salvas em", args.pasta)


if __name__ == "__main__":
    main()
