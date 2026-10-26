# Como contribuir

Obrigado pelo interesse! O projeto é aberto e cresce com relatos de uso, perfis de outros carros e melhorias no código. *English speakers: issues and pull requests in English are welcome too.*

## Regra principal: só consulta ao carro

O app **só lê** dados do veículo. Pull requests que façam qualquer uma destas coisas não são aceitos:
- escrever na ECU, acionar atuadores ou apagar códigos de falha;
- varrer endereços de módulos com pedidos de diagnóstico;
- escutar a rede CAN sem um modo silencioso garantido pelo hardware (`ATCSM1` aceito pelo adaptador, MCP2515 ou ESP32 em listen-only).

A escuta passiva e as regras dela estão em [docs/can-escuta.md](docs/can-escuta.md).

## Dados pessoais

As gravações de diagnóstico (`diag_*.jsonl`), os CSV e os backups contêm o **VIN**, o **trajeto GPS**, datas e o hodômetro do carro. Antes de anexar qualquer arquivo a uma issue:
- prefira recortes curtos e só das linhas que interessam;
- apague o VIN (resposta do `0902`) e o campo `gps` das linhas `snapshot`;
- nunca anexe um backup `.zip`.

Em testes e documentação, use valores fictícios para coordenadas, postos, datas, horários e hodômetro.

## Issues

- **Problema (bug):** o que aconteceu, o que era esperado, a versão do app, o celular e o adaptador. *Ajustes → Console da rede → Identificar adaptador* mostra se o ELM327 é clone.
- **Perfil de veículo novo:** marca, modelo, ano, motor, ECU e o protocolo encontrado (`ATDPN`). O guia [docs/criar-perfil.md](docs/criar-perfil.md) mostra como montar o perfil.
- **Sugestão:** o problema que a ideia resolve vale mais que a solução pronta.

## Pull requests

1. Crie uma branch a partir do `master`.
2. Mensagens de commit no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português: `feat:`, `fix:`, `docs:`, `build:`, `test:`, `refactor:`.
3. Registre a mudança em [CHANGELOG.md](CHANGELOG.md), na seção **[Não lançado]**.
4. Rode os testes antes de abrir o PR. O CI roda os mesmos:
   ```bash
   ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
   python3 -I -m unittest discover -s tools/trip-report -p 'test_*.py'
   python3 -I -m unittest discover -s tools/can-capture -p 'test_*.py'
   ```
   Requer JDK 17 e o Android SDK 37. Veja [Compilação](README.md#compilação) no README.

### Onde fica cada coisa

| Mudança | Onde |
|---|---|
| Carro novo, PIDs, fórmulas, alertas | Perfil JSON em `app/src/main/assets/profiles/`, sem código específico de carro no Kotlin |
| Tela do app | `app/src/main/assets/web/` (HTML, CSS e `app-*.js`) |
| Chamada nova da tela para o app | Um método `@JavascriptInterface` no objeto certo do pacote `bridge`. O `BridgeContractTest` confere os dois lados. Consultas ao banco respondem de forma assíncrona (`answerAsync` + `nativeAsync`) |
| Banco de dados | Room em `db/`, com migração testada em `RoomMigrationTest` e o esquema exportado em `app/schemas/` |
| Android Auto | `car/`, teste em `TelemetryScreenTest` |
| Ferramentas de análise | `tools/`, só com a biblioteca padrão do Python 3 |

Decisões já tomadas, para não reabrir sem um motivo novo:
- a tela continua em WebView;
- Jetpack Compose, Hilt e DataStore ficam para quando a WebView virar um problema medido (bateria ou travamentos);
- o app não está na Play Store, e os APKs saem pelas [Releases](https://github.com/AlanMartines/Universal-OBD-Dashboard/releases).

## Licença

Ao contribuir, você concorda que sua contribuição seja distribuída sob a [licença do projeto](LICENSE).
