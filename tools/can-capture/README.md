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

## Sessão guiada no carro

```bash
python3 tools/can-capture/roteiro.py /dev/ttyACM0 --pasta ~/captura-can
```

Um menu leva por cada etapa, na ordem (opção **A**) ou uma de cada vez:
1. conferência do cabo;
2. tensões dos pinos 6/14, com o diagnóstico do tipo de rede;
3. montagem;
4. teste de recepção;
5. ações (setas, pisca-alerta, portas, faróis, freios, cinto, partida), em sequência ou uma de cada vez;
6. hodômetro antes e depois de uma volta;
7. desmontagem.

Cada ação vira uma marca de nome fixo no momento do Enter. Um Enter a menos de 3 s da marca anterior é recusado. `r` refaz a ação e `p` pula, e as duas coisas ficam registradas. Nenhuma gravação sobrescreve outra: `acoes.log`, `acoes_2.log`… As tensões, os valores do painel e o que foi pulado vão para `anotacoes.txt`.

Formato da gravação: uma linha por quadro slcan, com o horário do computador em milissegundos na frente (`1700000000123 t2808…`). Linhas `# …` são estados do adaptador, e `# MARCA …` são as marcas. Também aceita slcan puro, sem horário.

Ligação e roteiro de captura: [docs/can-escuta.md](../../docs/can-escuta.md). Testes: `python3 -m unittest discover -s tools/can-capture -p 'test_*.py'`.
