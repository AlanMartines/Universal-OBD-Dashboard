# Veículos

Cada carro mapeado tem aqui a sua própria pasta. Nada de um veículo vale automaticamente para outro.

| Veículo | ECU | Protocolo do motor | Escuta CAN | Situação |
|---|---|---|---|---|
| [Fiat Uno Vivace 2012](fiat-uno-vivace-2012/) | Magneti Marelli IAW 7GF | ISO 14230-4 KWP FAST (pino 7) | Pino 14, 50 kbit/s | Motor em uso. Rede CAN em mapeamento |

## O que é comum e o que muda

| | Vale para todos | Muda por veículo |
|---|---|---|
| **ELM327** | Conector OBD e o app, que encontra o protocolo | Perfil JSON: PIDs, fórmulas e limites |
| **ESP32** (opcional) | [Guia de escuta](../docs/can-escuta.md), firmware e ferramentas de análise | Pinos, velocidade, transceptor, ligação e significado dos IDs |

Sem escuta CAN, o carro funciona normalmente pelo ELM327. Para isso basta o perfil: veja [Como criar o perfil do seu carro](../docs/criar-perfil.md).

## Como adicionar um veículo

1. Copie [`_modelo/`](_modelo/) para uma pasta `marca-modelo-ano`, em minúsculas e sem acentos.
2. Coloque o perfil em `app/src/main/assets/profiles/` e aponte para ele no `README.md` da pasta. O perfil fica lá porque vai dentro do APK.
3. Só se fizer escuta CAN, preencha `ligacao-can.md`. Sem escuta, apague esse arquivo.
4. Acrescente uma linha na tabela acima e abra um pull request.

## Regras

- **Só consulta:** nenhum comando de escrita, acionamento ou limpeza de falhas. Veja o [CONTRIBUTING](../CONTRIBUTING.md).
- **Só escuta na rede CAN:** com o modo silencioso garantido pelo hardware.
- **Diga o que foi testado:** marque cada sinal e cada ligação como confirmado, provável ou candidato, e como foi conferido.
- **Sem dados pessoais:** nada de VIN, hodômetro, placa, localização ou gravações reais. Use exemplos fictícios.
- **Sem material protegido:** manuais e tabelas de outros aplicativos não entram. Cite a fonte.
