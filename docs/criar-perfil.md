# Como criar o perfil do seu carro

O app não tem nada de um carro específico no código. Tudo o que muda de um veículo para outro fica num **perfil JSON**: o que pedir à ECU, como converter as respostas, a capacidade do tanque, as faixas de temperatura e os alertas.

Os perfis que vêm com o app ficam em [`app/src/main/assets/profiles/`](../app/src/main/assets/profiles/). Para um perfil novo:
- importe-o em *Ajustes → Importar perfil JSON*;
- ou abra um pull request com o arquivo nessa pasta.

## 1. Comece pelo genérico

Copie o [`generic_obd2.json`](../app/src/main/assets/profiles/generic_obd2.json). Ele usa:
- só os PIDs da norma SAE J1979;
- busca automática de protocolo (`ATSP0`).

Na primeira conexão, o app consulta quais PIDs a ECU suporta (`0100`, `0120`, `0140`) e desativa os outros sozinho. Troque:
- `profile_id`: só letras minúsculas, números e `_`;
- `vehicle_name`, `ecu_model` e `engine`.

## 2. Descubra o protocolo real

Ative *Ajustes → Gravação de diagnóstico* e faça uma captura curta. No arquivo `diag_*.jsonl`, procure a resposta do `ATDPN`, que é o protocolo que o adaptador encontrou. Depois:
- **Fixe o protocolo** no `init_commands`, trocando `ATSP0` por `ATSPx`, onde `x` é o número do protocolo, ou `ATSPAx` para tentar esse primeiro e buscar se falhar. A conexão fica mais rápida.
- **Ajuste as esteiras (`lanes`)** à velocidade do barramento. A linha K (ISO 9141/14230) faz cerca de 5 leituras por segundo; CAN faz bem mais. Deixe na esteira rápida só o que o painel precisa ver mudar (RPM, velocidade, MAP).

## 3. Confira as fórmulas com dados reais

Cada PID tem uma `formula` sobre os bytes da resposta: `A`, `B`, `C`… Exemplo: `((A*256)+B)/4` para a rotação. Há ECUs que fogem da norma.

Por exemplo, a IAW 7GF do Fiat Uno manda o avanço de ignição sem o deslocamento de −64°, e o ajuste de curto prazo do combustível como byte com sinal. As fórmulas corrigidas e o porquê de cada uma estão em [`docs/veiculos/uno-vivace-7gf.md`](veiculos/uno-vivace-7gf.md).

A ferramenta [`tools/trip-report`](../tools/trip-report/) recalcula uma gravação inteira com as fórmulas do perfil. Ela mostra faixas e médias, e assim fica fácil ver um valor absurdo antes de ir para o carro.

Recursos das fórmulas:
- Operadores: `+ - * / %`, comparações, `&& || !`, bit a bit `& | ^ << >>` e o ternário `cond ? a : b`.
- Funções: `signed8()`, `signed16()`, `min()`, `max()`, `clamp()`, `abs()`, `round()`, `floor()`, `ceil()`, `sqrt()`.
- Várias saídas da mesma resposta (`outputs`). É o caso do `0101`, que dá a luz de injeção, a contagem de falhas e os monitores de prontidão.
- `"hidden": true` numa saída esconde o valor da lista de sensores (ex.: bytes brutos).

## 4. Papéis (`roles`)

Os papéis dizem ao app qual saída é a rotação, a velocidade, o MAP, a temperatura, a tensão etc. Com eles, o painel, o consumo, a marcha e os alertas funcionam sem saber os ids do seu perfil. Use `null` para desligar um papel cuja leitura não é confiável nesse carro.

## 5. Consumo

O consumo vem do bloco `fuel`:
- `method`:
  - `speed_density` usa MAP, RPM e temperatura do ar, com `displacement_l` e `volumetric_efficiency`;
  - `maf` usa o sensor de fluxo de ar.
- `gasoline` e, em carro flex, `ethanol`: relação ar/combustível e densidade de cada combustível.
  - No Brasil, `gasoline` é a **gasolina C** da bomba, que já vem com etanol anidro (E27 a E32, conforme a época): use a relação ar/combustível dela, não a da gasolina pura (14,7). `ethanol` é o etanol hidratado da bomba de etanol. O % que o usuário escolhe em Ajustes é a parte do tanque que veio da bomba de etanol.
- `decel_fuel_cut_condition`: quando a injeção corta em desaceleração e o consumo é zero.
- `obd_speed_factor`, na raiz do perfil: corrige a velocidade da ECU para bater com o hodômetro.

Não precisa acertar `volumetric_efficiency` de primeira. Registre os abastecimentos de tanque cheio em *Abastecimentos*: depois de 3 intervalos, o card **Calibração do consumo** sugere a correção.

## 6. Painel, temperatura, marchas e alertas

- `dashboard`: rotação máxima e faixa vermelha.
- `thermal`: abertura do termostato, as duas velocidades da ventoinha e a temperatura crítica.
- `shift_indicator`:
  - velocidades de troca do manual do proprietário;
  - opcional: `gear_kmh_per_1000rpm`, os km/h a cada 1000 rpm em cada marcha, para o app deduzir a marcha engatada. Dá para medir com a ferramenta de recálculo.
- `alerts`: condições sobre os ids das saídas, com tempo mínimo (`sustain_ms`) e mensagem com valores (`{coolant_temp}`).
- `dtc_descriptions`: textos dos códigos de falha específicos do seu carro.

## 7. Só consulta

O app foi feito para **ler**. O perfil deve conter apenas pedidos de consulta:
- modo `01` (dados atuais), `03`/`07`/`0A` (códigos de falha), `09` (identificação);
- comandos `AT` do próprio adaptador.

Não coloque comandos que escrevam na ECU, acionem componentes ou apaguem códigos.
