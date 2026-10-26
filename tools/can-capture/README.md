# Escuta CAN

Grava e analisa a saída do [firmware/arduino-can-listen](../../firmware/arduino-can-listen), um Arduino Uno com MCP2515 em modo Listen-Only. A ferramenta só lê a porta USB e nunca escreve no adaptador. Só usa a biblioteca padrão do Python 3.

```bash
# Grava; Enter (com texto opcional) marca um evento
python3 tools/can-capture/can_capture.py gravar /dev/ttyACM0 -o captura.log [--segundos 120]

# Resumo por ID, comparação antes/depois e o que muda em volta de cada marca
python3 tools/can-capture/can_capture.py resumo captura.log
python3 tools/can-capture/can_capture.py comparar antes.log depois.log
python3 tools/can-capture/can_capture.py marcas captura.log --janela 2
```

Formato da gravação: uma linha por quadro slcan, com o horário do computador em milissegundos na frente (`1700000000123 t2808…`). Linhas `# …` são estados do adaptador, e `# MARCA …` são as marcas. Também aceita slcan puro, sem horário.

Ligação e roteiro de captura: [docs/can-escuta.md](../../docs/can-escuta.md). Testes: `python3 -m unittest discover -s tools/can-capture`.
