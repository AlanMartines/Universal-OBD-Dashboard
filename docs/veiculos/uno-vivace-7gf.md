# Fiat Uno Vivace 1.0 Flex — IAW 7GF

Especificações usadas pelo perfil [`fiat_uno_vivace_7gf.json`](../../app/src/main/assets/profiles/fiat_uno_vivace_7gf.json).

Fonte: *Mecânica 2000 Automotive*, volume 54 (2011), "Uno Vivace 1.0 Flex – Injeção Magneti Marelli IAW 7GF". O PDF é material comercial com direitos autorais e não é versionado (`docs/veiculos/*.pdf` está no `.gitignore`). As páginas citadas abaixo são as do manual.

## Comunicação OBD

- O conector de diagnóstico fica no habitáculo, na parte inferior esquerda do painel (pág. 163).
- O módulo de comando (MC) chega ao **pino 7** do conector (linha K, ISO 9141-2 / ISO 14230 KWP2000). Os pinos 6 e 14 (CAN) vão ao painel de instrumentos (pág. 163). O MC também está na rede CAN do veículo (bornes B13/B14, pág. 162), mas o caminho de diagnóstico desenhado no manual é a linha K.
- Por isso o perfil usa busca automática de protocolo (`ATSP0`) e o app identifica o protocolo real com `ATDPN`. Confirmar com a gravação de diagnóstico do primeiro uso no carro.

## Dados reais da ECU (viagem de teste)

Medido com ELM327 v1.5 (PIC18F25K80) em ~900 km / 13,6 h de gravação de diagnóstico.

- **Protocolo: ISO 14230-4 KWP FAST** (`ATDPN` = `A5`), como indicava o manual. O perfil usa `ATSP5`, que fixa o KWP FAST sem busca automática. Com `ATSPA5`, uma falha de inicialização (por exemplo, ignição desligada) fazia o ELM327 procurar os protocolos CAN, transmitindo a 500 kbps na rede da carroceria dos pinos 6/14, que é de 50 kbps.
- **Velocidade da linha K:** ~5 leituras/s (mediana de 194 ms por PID, contra 38 ms do `ATRV`, que só passa pelo Bluetooth). Por isso a faixa rápida tem só RPM, velocidade e MAP.
- **PIDs anunciados:** `01 03 04 05 06 07 0B 0C 0D 0E 0F 11 13 14 15 1C 21`. Não há `0142` (tensão vem do `ATRV`), nem MAF, nem nível de combustível. `011C` = `1D` (norma OBDBr-2).
- **Codificações fora do padrão SAE nesta ECU:**

| PID | Resposta real | Fórmula usada |
|---|---|---|
| `0E` avanço | sem o deslocamento de −64°: `0A` na lenta, `2C`–`41` em cruzeiro | `signed8(A)/2` → 5° na lenta, 22–32° em cruzeiro |
| `06` STFT | byte com sinal centrado em zero (`00`, `FB`, `F4`…) | `signed8(A)*100/128` |
| `07` LTFT | salta a cada amostra (`0A 80 F3 D3…`) — não é ajuste de longo prazo | não é lido |
| `14` sonda pré | byte A sempre `FF`; só o B varia | não é lido |
| `15` sonda pós | 0,72–0,77 V estável (`8E`–`9A`) | `A/200` — sinal de catalisador eficiente |
| `11` borboleta | `1D` fechada (11,4%) a `DE` aberta (87%) | normalizada: `clamp((A-29)*100/193, 0, 100)` |

- **Relações de marcha** (km/h a cada 1000 rpm, picos em ~6.000 pares RPM/velocidade): **1ª 6,0 · 2ª 11,3 · 3ª 17,5 · 4ª 25,0 · 5ª 29,5**.
- **Temperaturas:** motor em 81–92 °C na estrada (mediana 83 °C), máximo 99 °C; eletroventilador de 1ª entrou aos 97 °C. Ar admitido 24–68 °C.
- **Elétrica (`ATRV`):** 13,8–14,0 V com o motor ligado; 11,8 V no mínimo, na partida.
- **Falhas:** nenhuma; MIL apagada a viagem toda.

## Motor (pág. 4)

| Item | Valor |
|---|---|
| Motor | Fire EVO 1.0 8V Flex, transversal dianteiro, 4 cilindros em linha |
| Diâmetro × curso | 70,0 × 64,9 mm → 999 cm³ |
| Razão de compressão | 12,15 : 1 |
| Ordem de ignição | 1-3-4-2 |
| Válvulas | 2 por cilindro, distribuição por correia |
| Potência | 73,0 cv a 6250 rpm (gasolina) · 75,0 cv a 6250 rpm (etanol) |
| Torque | 9,5 kgfm a 3850 rpm (gasolina) · 9,9 kgfm a 3850 rpm (etanol) |
| Marcha lenta | **815 ± 50 rpm** |
| Transmissão | manual de 5 marchas (relações medidas: ver "Dados reais da ECU") |
| Velas | NGK BKR6E |

## Combustível (pág. 5, 215)

| Item | Valor |
|---|---|
| Injeção | Magneti Marelli IAW 7GF, sem sensor MAF: o conjunto medidor de densidade (CMD) mede pressão (MAP) e temperatura do ar |
| Bomba | elétrica de turbina; pressão especificada 4,2 bar, medida ≈ 3,8 bar após o filtro, vazão ≈ 1560 ml/min |
| Tanque | **48,0 L**, incluindo reserva de **5,5 a 7,5 L** |
| Partida a frio | reservatório de 2,0 L |

## Arrefecimento (pág. 4, 55–56)

| Item | Valor |
|---|---|
| Válvula termostática | abre em torno de **87 °C** (faixa 80–90 °C) |
| Eletroventilador 1ª velocidade | liga a ≈ **97 °C**, desliga a ≈ 91 °C |
| Eletroventilador 2ª velocidade | liga a ≈ **103 °C**, desliga a ≈ 100 °C |
| Tolerância | ± 2 °C |
| Sistema | fechado e pressurizado, 5,3 L; tampa 1,4 ± 0,1 bar; 50% aditivo + 50% água |

O comando dos relés do eletroventilador é feito pelo MC (bornes B19 e B03) a partir do sensor ECT.

## Sistema elétrico (pág. 4)

| Item | Valor |
|---|---|
| Bateria | 12 V, 50 Ah (sem A/C) ou 60 Ah (com A/C) |
| Alternador | 90 A (sem A/C) ou 110 A (com A/C) |
| Motor de partida | Bosch 12 V / 0,9 kW |

## Valores ideais dos sensores (pág. 215)

| Sensor | Teste | Valor ideal |
|---|---|---|
| HEGO 1 (sonda pré-catalisador) | tensão de resposta | 100 a 800 mV, oscilante |
| HEGO 2 (sonda pós-catalisador) | tensão de resposta | 80 a 300 mV, oscilante |
| HEGO 1 / 2 | resistência do aquecedor | ≈ 7,5 Ω / ≈ 7,3 Ω |
| CMD | tensão do sensor de temperatura do ar a 27 °C | ≈ 2,5 V |
| CMD | tensão do sensor de pressão | ≈ 3,7 V |
| CMD | alimentação · resistência a 28 °C | ≈ 5,0 V · ≈ 1,55 kΩ |
| ECT | tensão com motor frio (28 °C) · resistência a 70 °C | ≈ 2,8 V · ≈ 1,8 kΩ |
| VSS | frequência a 20 km/h | ≈ 85 Hz |
| CMP | frequência em marcha lenta | ≈ 35 Hz |
| ETC (borboleta) | potenciômetros 1 / 2 em repouso | ≈ 1,07 V / ≈ 3,91 V |
| SPA (pedal) | potenciômetros 1 / 2, pedal livre | ≈ 1,0 V / ≈ 4,5 V |
| Eletroinjetor | resistência | ≈ 14,0 Ω |

## Códigos de falha da injeção (pág. 163)

| Código | Item | Código | Item |
|---|---|---|---|
| P0105 | Conjunto medidor de densidade (CMD) | P0301–P0304 | Falha de ignição no cilindro 1–4 |
| P0110 | Temperatura do ar do coletor (CMD) | P0325 | Sensor de detonação (KS) |
| P0115 | Temperatura do líquido de arrefecimento (ECT) | P0335 | Sensor de rotação (CKP) |
| P0120 | Potenciômetro 1 da borboleta (ETC) | P0340 | Posição do comando de válvulas (CMP) |
| P0130 | Sonda lambda (HEGO) | P0351–P0354 | Bobinas de ignição (DIS) |
| P0135 | Aquecedor da HEGO 1 | P0420 | (manual: purga do cânister) |
| P0141 | Aquecedor da HEGO 2 | P0443 | (manual: sensor de velocidade) |
| P0201–P0204 | Eletroinjetor 1–4 | P1122 | Potenciômetro 2 da borboleta (ETC) |
| P0300 | Falha de ignição | | |

No manual, as descrições de P0420 e P0443 parecem deslocadas em relação à SAE J2012 (P0420 = eficiência do catalisador, P0443 = purga do cânister, P0500 = sensor de velocidade). O perfil segue o padrão SAE e inclui P0500.

## Rede do painel (pinos 6/14): pesquisa de 24/10/2026

O nível do tanque não vem pela ECU: o PID `012F` não é anunciado. O caminho em estudo é escutar a rede CAN que liga o painel aos outros módulos. Para isso serve o console da rede da v0.5.0, que só escuta (`ATCSM1`).

**Atualização de 26/10/2026:** o ELM327 clone deste carro responde `?` ao `ATCSM1`, então o console cancela a escuta. O mapeamento passa a ser feito com Arduino Uno + MCP2515 em modo Listen-Only (cristal de 8 MHz), que garante no hardware que nada é transmitido. Ligação e roteiro em [can-escuta.md](../can-escuta.md).

**O que indica que a escuta pode funcionar:**
- Neste carro, os pinos 6/14 vão ao **painel de instrumentos**, e a ECU também está na rede CAN, pelos bornes B13/B14 (manual, pág. 162–163). A ECU faz o diagnóstico pela linha K (pino 7), então a rede dos pinos 6/14 é a da carroceria.
- O manual de serviço do Uno ([cópia no Scribd](https://pt.scribd.com/document/595476810/Uno-Evo-Manual-de-Servico)) descreve uma **Body CAN de baixa velocidade, 50 kbit/s**. No console, escolha **50 kbps** em vez da busca automática.
- A **Fiat Ducato X250 (2009)** tem a mesma arquitetura: motor em KWP2000 no pino 7 e rede da carroceria a 50 kbit/s nos pinos 6/14, sem nada a 500 kbit/s. Esses IDs foram decodificados só escutando ([fiat-ducato-x250-wican](https://github.com/danderik88/fiat-ducato-x250-wican)). Servem de ponto de partida, mas no Uno devem ser outros:

  | ID (Ducato) | Sinal |
  |---|---|
  | `0x281` | RPM `(b6·256+b5)/8`, temperatura do motor `b3−40` |
  | `0x286` | velocidade `(b2·256+b3)/16` km/h |
  | `0x380` | nível de combustível no b5 (escala não publicada), reserva no b4 bit 1, tensão da bateria `b3×0,16` V |
  | `0x603` | hodômetro (20 bits), autonomia, consumo instantâneo |

- Em outros Fiat com rede de carroceria (Doblò, Grande Punto, 500), os IDs costumam ser de **29 bits**: 2 bytes de assunto e 2 do módulo que envia. O console entende IDs de 11 e de 29 bits.

**Riscos:**
- Punto Evo, Grande Punto, 500 e Doblò 263 levam a rede da carroceria aos **pinos 1/9**, fora do alcance de um ELM327 comum ([manual do AlfaOBD](https://www.alfaobd.com/AlfaOBD_Android_Help.pdf)). Se o console mostrar **0 quadros em todas as velocidades**, a primeira suspeita é essa. O teste seria o cabo "amarelo" (adaptador 3 do MultiECUScan): ferramenta 6 → carro 1, 14 → 9, 7 → 12.
- O nível pode nunca circular na rede, se a boia for ligada direto ao painel e nenhum outro módulo precisar dele.
- O ELM327 só liga o pino 7 à linha K. Em Fiats mais antigos, o painel e o ar-condicionado usam a linha K do pino 9 (manual do AlfaOBD), e o ar-bag a do pino 3. Isso pode explicar parte da falha do AlfaOBD com o adaptador comum.
- Alguns clones de ELM327 têm um resistor de 120 Ω entre os pinos 6 e 14, o que pode perturbar uma rede lenta. Neste carro, o adaptador ficou ~900 km conectado sem efeito visível no painel.

**Procedimento:** com a ignição ligada e o motor desligado, grave uma escuta de 60 s a 50 kbps, abasteça e grave outra. Depois compare os bytes que mudaram (resumo `can_summary` de cada arquivo).

**Conector deste carro (fotos de 26/10/2026):** só há terminais nos pinos **4, 5, 6, 7, 14 e 16**. Os pinos 1 e 9 estão vazios, assim como 2, 3, 8, 10, 11, 12, 13 e 15. Não há rede de carroceria nos pinos 1/9, nem linhas K de ABS, painel ou air-bag. Tudo o que vai ao painel passa pela CAN dos pinos 6/14, que o ELM327 comum já lê. A seção abaixo vale só para outros Fiat.

### Se a rede estiver nos pinos 1/9: o que o adaptador permite

- **Antes de mexer no adaptador**, meça os pinos 1 e 9 com a ignição ligada e o terra no pino 5:
  - nada, ou terminal ausente: não há rede ali;
  - ~12 V: linha K (o pino 9 é a linha K do painel no esquema antigo), não CAN;
  - um pino perto de 0–1 V e o outro perto de 4–5 V: CAN lenta de carroceria.
- **ELM327 (PIC18F25K80):**
  - Os pinos 23 (CAN Tx) e 24 (CAN Rx) são sinais lógicos que, segundo o [datasheet](https://cdn.sparkfun.com/assets/learn_tutorials/8/3/ELM327DS.pdf), precisam passar por um transceptor. Nos clones, ele é o MCP2551 ou o SIT1040: perna 7 = CAN-H, perna 6 = CAN-L.
  - O PIC tem um único módulo ECAN. O bit `CANMX` só alterna o módulo entre RB2/RB3 e RC6/RC7, e RC6/RC7 já são o RS232 do Bluetooth.
  - O firmware não tem comando para selecionar outra rede.
  - Por isso, ligar os pinos 1/9 direto no PIC não funciona. Ligá-los em paralelo com 6/14 junta duas redes do carro e não deve ser feito.
- **Melhor opção: chave DPDT ON-ON dentro do adaptador.**
  - Os fios do transceptor vão aos terminais do meio da chave; um lado vai aos pinos 6/14 e o outro aos pinos 1/9. O pino 7 (motor) continua ligado nas duas posições.
  - Retire o resistor de 120 Ω ("121") entre CAN-H e CAN-L, se houver.
  - Confira a continuidade antes de fechar a caixa: 6 e 1 = alto, 14 e 9 = baixo, e o plugue do adaptador é espelhado.
  - Troque de posição só com a ignição desligada.
- **Alternativa sem abrir o adaptador:** o cabo amarelo, mas ele desliga o pino 7 do carro.

## Itens que o OBD não informa

- Pressão do óleo: a luz STOP do quadro é ligada direto ao pressostato.
- Hodômetro: o app soma os km das viagens gravadas.

## Calibração com abastecimentos (viagem de teste)

Três abastecimentos de tanque cheio (gasolina C, cupons fiscais) e o hodômetro do painel:

| Intervalo | Hodômetro | GPS | ECU | Litros | Consumo (hodômetro) | `volumetric_efficiency` |
|---|---|---|---|---|---|---|
| Trecho 1 | 418 km | 425,3 km | 406,6 km | 32,203 | 13,0 km/l | 0,972 |
| Trecho 2 | 467,6 km | 476 km | 456 km | 37,368 | 12,5 km/l | 1,000 |

- `volumetric_efficiency` = **0,99**: o consumo estimado da ida inteira fica a 0,3% dos litros reais (69,8 × 69,57 L).
- A velocidade da ECU fica 2,6% abaixo do hodômetro; o GPS, 1,8% acima. `obd_speed_factor` = **1,026** corrige a distância quando não há GPS.
- Custo: R$ 0,49/km com gasolina a R$ 6,19–6,69/L.

### Volta (gasolina C)

| Intervalo | Litros reais | Consumo | App (com gasolina) |
|---|---|---|---|
| Trecho 3 (387 km) | 31,6 | 12,2 km/l | 33,1 L (+4,7%) |
| Trecho 4 (334 km) | 31,4 | 10,6 km/l | 31,1 L (−1,1%) |

- **Distância:** ECU × 1,026 = 1.025,2 km, contra 1.025 km pelo hodômetro do carro.
- **Somando ida e volta**, o app fica +1,1% acima dos litros reais, dentro da variação de enchimento na bomba. Mantida `volumetric_efficiency` = 0,99.
- **Etanol em 100% por engano:** na volta, o app calculou com 100% de etanol (fator 1,425 constante), o % escolhido em Ajustes. Corrigido na v0.5.1: o % é escolhido numa lista e é ajustado pelo abastecimento registrado.

## A calibrar com dados reais

- Consumo com etanol (só houve abastecimento com gasolina até agora).
- Comportamento real da HEGO 2 para um futuro alerta de catalisador.
