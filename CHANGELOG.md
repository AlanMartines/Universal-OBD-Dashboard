# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Alterado
- **Ferramentas de build atualizadas:**
  - Android Gradle Plugin 9.4.1, com o Kotlin embutido no AGP;
  - Gradle 9.8.2, Kotlin 2.4.21 e KSP 2.3.12;
  - compila com o **SDK 37**; o `targetSdk` continua 36, então o comportamento do app no celular não muda.
- **Build em Kotlin DSL** (`*.gradle.kts`), com as versões centralizadas em `gradle/libs.versions.toml`. Some a sintaxe Groovy que deixaria de funcionar no Gradle 10.
- **Bibliotecas:** core 1.19.1, activity 1.13, fragment 1.9.1, lifecycle 2.11, webkit 1.18, Room 2.8.5, play-services-location 21.4, coroutines 1.11, kotlinx-serialization 1.12, Robolectric 4.17 e androidx.test 1.7/1.3. Cobre os PRs #1–#4 do Dependabot.
- Gravação das preferências no formato `edit { }` do androidx (avisos `UseKtx` do lint novo).

### Corrigido
- Se o processo que desenha a tela (WebView) travasse ou fosse encerrado pelo Android por falta de memória, por exemplo com o painel aberto por horas, o app inteiro fechava. Agora a tela é recriada e a captura em segundo plano continua.

## [0.8.1] - 2026-10-26

Primeira versão pública do repositório.

### Alterado
- Dados pessoais retirados dos testes e da documentação. Coordenadas, postos, datas e horários de viagem e leituras do hodômetro viraram valores genéricos ou fictícios. Litros, distâncias e consumos reais continuam os mesmos, então todas as contas e testes valem igual.
- CI: `actions/checkout` 7, `actions/setup-java` 6, `actions/upload-artifact` 7 e `gradle/actions` 6.

## [0.8.0] - 2026-10-26

### Adicionado
- **Monitores de prontidão** em Detalhes: quais autodiagnósticos a ECU suporta e se já completaram (catalisador, sonda, sistema de combustível…), dos bytes B–D do `0101`, que o app já lia.
- **Congelamento de quadro da ECU** (modo 02): ao surgir uma falha nova, o app lê uma vez o quadro gravado pela própria ECU. O quadro aparece no histórico de falhas e entra no "Explicar com IA". É só consulta.
- **Calibração do consumo** em Abastecimentos:
  - compara litros reais com o estimado pelo app em cada intervalo entre tanques cheios (integral do consumo gravado no período);
  - sugere um fator de correção, aplicado por veículo com um toque;
  - ignora intervalos com diferença acima de 25%.
- **Respostas da IA guardadas:** a análise de uma viagem e a explicação de uma falha ficam salvas e reabrem sem consultar de novo; há um botão "Consultar de novo".
- **Backup completo** em Ajustes:
  - gera um .zip com banco, ajustes e perfis importados; a chave de IA não entra;
  - restaurar migra backups de versões anteriores e recusa os de versões mais novas.
- Documentação: [guia de perfil de veículo](docs/criar-perfil.md), [teste do Android Auto](docs/android-auto.md), [resumo em inglês](README.en.md) e imagens dos temas no README.

### Alterado
- **Autonomia no painel:**
  - usa o consumo real medido nos abastecimentos;
  - com a captura parada, mostra o último nível salvo do tanque;
  - sem nível conhecido, sugere registrar um abastecimento.
- A estimativa do app em cada intervalo de Abastecimentos vem da telemetria do período, e não mais da viagem inteira, que distorcia quando uma viagem cruzava vários abastecimentos.
- **Banco de dados v3:** coluna do congelamento de quadro da ECU e tabela de respostas da IA. A migração preserva tudo.
- **Código:**
  - a ponte JavaScript foi dividida em cinco objetos por assunto (pacote `bridge`);
  - a tela foi dividida em `app-*.js`, carregados em ordem;
  - `MainActivity` caiu de 1.158 para ~500 linhas.
- **APK de release otimizado pelo R8** (de ~5,4 MB para ~1 MB). O código do app é mantido inteiro e só as bibliotecas são enxugadas.
- Dependências atualizadas até o limite do SDK de compilação 35: core 1.16, activity 1.10, fragment 1.8.9, webkit 1.14, Car App 1.7, Room 2.7. O salto para o SDK 36 fica para depois.
- Android Auto: a lista de hosts aceitos no release passou a ser do próprio app (antes usava um recurso privado da biblioteca).

### Testes
- Migração do banco v1 → v3 com SQLite real (Robolectric), backup de ponta a ponta, tela do Android Auto (biblioteca oficial de testes), contrato entre a tela e as pontes nativas, checagens estáticas da tela (ids e nomes repetidos) e paridade do cálculo de consumo entre o app e `tools/trip-report`.
- CI: testes Python da ferramenta e job **smoke**, que abre num emulador o APK otimizado.

### Corrigido
- Os monitores de prontidão não apareciam: o id e o nome da função coincidiam com os do cartão "Pronto para viajar". O defeito foi achado pelos novos testes da tela.

## [0.7.1] - 2026-10-26

### Segurança
- Links externos (como o mapa no histórico de falhas) abriam **dentro** da WebView do app, onde a ponte nativa fica visível para qualquer página carregada. Agora só as páginas do próprio app ficam na WebView: links externos abrem no navegador ou no app de mapas, e uma navegação inesperada volta para o painel.

## [0.7.0] - 2026-10-26

### Adicionado
- **Assistente IA → Analisar viagem** (botão **Analisar com IA** em cada viagem do histórico):
  - o celular resume a viagem: tempos em movimento e parado, faixas de velocidade e de rotação, tempo em cada marcha estimada, consumo em até 8 trechos, temperaturas, tensão e falhas;
  - a IA comenta o consumo, a condução, a saúde do motor e dá dicas;
  - não envia coordenadas, horário nem VIN.
- **Assistente IA → Perguntar à IA** (Histórico): conversa livre sobre o carro, com sugestões de perguntas.
  - A IA recebe um resumo do histórico: viagens (data sem horário), abastecimentos sem nome do posto nem observações, consumo real, gastos por mês e falhas.
  - A conversa guarda as últimas 6 mensagens.
- **Confirmação por tipo de envio:** antes do primeiro envio de cada tipo (falha, viagem, pergunta), o app mostra o texto exato e espera o **Enviar**. O lado nativo recusa o envio sem essa confirmação.

## [0.6.1] - 2026-10-26

### Adicionado
- **Console → Identificar adaptador:** roda só comandos internos do adaptador (`ATI`, `AT@1`, `AT@2`, `ATPPS`, `ATCSM1`, `STI`, `ATRV`), nada para o carro. Diz se o ELM327 é clone, comparando a versão que ele declara com os comandos que ele conhece (a v1.5 nunca existiu, e o `ATCSM` existe desde a v1.4), ou se é um chip STN (OBDLink). O resultado fica no histórico do console.

## [0.6.0] - 2026-10-26

### Adicionado
- **Assistente IA (opcional)**, em *Ajustes → Assistente IA*: explica códigos de falha com a IA escolhida (OpenAI, Claude, Gemini ou qualquer serviço compatível com o formato OpenAI). Aparece como **Explicar com IA** nas falhas ativas e no histórico.
  - A chave de API fica cifrada com o Android Keystore e aparece mascarada.
  - Só saem do celular o veículo, o motor, o código e as leituras do momento da falha, nunca GPS, trajeto, horário ou VIN.
  - Antes do primeiro envio, o app mostra o texto exato que vai sair.
  - Só funciona com internet. Sem chave ou sem conexão, o resto do app não muda.

### Alterado
- O app passa a declarar as permissões `INTERNET` e `ACCESS_NETWORK_STATE`, usadas só pelo assistente IA.

## [0.5.2] - 2026-10-26

### Adicionado
- **Abastecimentos → Importar:** botão **Escolher arquivo .csv**, que carrega o arquivo do celular na caixa de importação para conferir antes de importar. Também há a opção **Substituir todos os abastecimentos pelos do CSV**: apaga os registros só depois de validar o arquivo inteiro, numa única transação.

## [0.5.1] - 2026-10-26

### Corrigido
- **Abastecimentos:** o campo de data e hora ficava parado no horário do registro anterior. Um abastecimento registrado horas depois saía com o horário velho e não acertava o tanque. Agora o campo acompanha o relógio até ser editado.
- **Etanol no tanque:** o controle deslizante de Ajustes trocou de lugar com uma lista. Arrastar a página podia mudar o % sem querer: na volta da viagem de teste, o app calculou 100% de etanol e estimou 42% a mais de combustível.

### Adicionado
- Abastecimento registrado na hora acerta o nível do tanque (cheio = capacidade; parcial = soma os litros) e, em carro flex, o **% de etanol da mistura**, ponderado pelo volume. A tela informa o resultado ("Tanque: 48,0 L · etanol 0%").
- Ajustes → Nível atual acompanha a estimativa do tanque com a captura rodando.

## [0.5.0] - 2026-10-24

### Adicionado
- **Console da rede** (*Ajustes → Console da rede*): tela tipo terminal que **escuta por 60 s** a rede CAN dos pinos 6/14, em **modo silencioso** (ATCSM1): nada é enviado ao carro, e a escuta é cancelada se o adaptador não aceitar esse modo. Acha a velocidade da rede sozinho (500 a 33,3 kbps) ou usa a escolhida e termina com um resumo por ID dos bytes que variaram. Cada escuta fica no **histórico** (ver, exportar .gz, apagar) como `diag_<data>_console-escuta.jsonl`. Objetivo: comparar uma gravação antes e outra depois de abastecer para achar o nível do tanque.
- Com o console em uso, a captura não inicia (o adaptador atende uma conexão por vez).

## [0.4.0] - 2026-10-24

### Adicionado
- **Aba Abastecimentos:** registro de cada abastecimento (data, hodômetro, litros, valor, preço por litro, combustível, tanque cheio, posto) com **consumo real** entre tanques cheios, **custo por km**, gasto do mês, comparação com o consumo estimado pelo app e ponto de equilíbrio **etanol × gasolina** medido no carro.
- Tanque cheio registrado na hora acerta o nível estimado do tanque e o hodômetro do app.
- **Exportar/Importar CSV** de abastecimentos.
- `tools/trip-report --fuel-csv`: calibração do consumo intervalo a intervalo a partir do CSV exportado.

### Alterado
- Banco de dados na versão 2 (tabela de abastecimentos); a migração preserva viagens, telemetria e falhas.

## [0.3.2] - 2026-10-24

### Corrigido
- Consumo do Fiat Uno calibrado com três abastecimentos reais de tanque cheio (901 km, 69,57 L): o app subestimava o consumo em ~19% (mostrava ~16 km/l; real 12,5–13,2 km/l). `volumetric_efficiency` 0,80 → 0,99.
- Distância sem GPS: novo `obd_speed_factor` no perfil (Uno = 1,026), para bater com o hodômetro do carro.
- `tools/trip-report`: o período de calibração agora recorta a gravação segundo a segundo.

### Adicionado
- *Ajustes → Hodômetro do carro*: com o km do painel informado, o "Total" dos temas acompanha o hodômetro real.

## [0.3.1] - 2026-10-24

### Corrigido
- Painel: números grandes sem dado apareciam como retângulos; agora um traço fino e esmaecido.
- Painel: o tempo da viagem continuava contando depois de encerrar a captura.
- Painel: os dois botões "AUTO" do rodapé agora se chamam **Telas auto** (troca automática de tela) e **Luz auto/dia/noite**.
- Tema Minimal em retrato: campos maiores e distribuídos na altura da tela.

## [0.3.0] - 2026-10-24

### Adicionado
- **Painel de instrumentos** na aba *Painel*, com três temas trocáveis (Minimal, Cápsula e HUD neon), modo dia/noite e três telas de seis campos (Estrada, Motor, Viagem) com troca por toque, deslize ou automática. O painel anterior passa para a aba *Detalhes*.
- **Modo suporte do carro:** celular na horizontal com o Painel aberto → tela cheia; Painel aberto durante a captura → tela sempre ligada.
- Hodômetro do app ("Total" nos temas): soma das distâncias das viagens gravadas.
- `tools/trip-report`: recálculo das viagens a partir das gravações de diagnóstico (relatório, calibração do consumo por abastecimento e trecho para o protótipo).
- `tools/painel-preview`: protótipo dos temas com simulador ou trecho de viagem real.

### Problemas conhecidos
- Consumo, média e autonomia ainda são estimativas: a calibração (`volumetric_efficiency`) depende dos dados de abastecimento.
- No Fiat Uno a sonda pré-catalisador não é confiável (campo "Sonda" mostra "--").
- Painel ainda não testado em celular; o Android Auto continua com a grade simples.

## [0.2.7] - 2026-10-24

### Corrigido
- Retomada da viagem só depois de **desconexões automáticas** (ignição desligada, Bluetooth caiu, inatividade sem resposta, app reiniciado pelo sistema). Encerrar à mão (*Encerrar viagem* no app, na notificação ou no Android Auto, ou *Encerrar agora* da inatividade) faz a próxima captura começar uma viagem nova.

## [0.2.6] - 2026-10-24

Captura mais robusta e contínua, a partir da viagem de ida (9 sessões separadas por pausas de 0,3 a 18 min).

### Adicionado
- **Retomada da viagem:** uma captura que começa até 1 hora depois do fim da anterior continua a mesma viagem (totais, histórico, CSV/GPX) e o mesmo arquivo de diagnóstico, inclusive quando o sistema reinicia o app. Intervalo ajustável (30 min a 12 h, ou nunca).
- Tempo de inatividade ajustável em *Ajustes → Captura*: 5, 15 ou 30 min, ou nunca (padrão 15 min; antes, 5 min fixos).
- Checklist **Pronto para viajar** em *Ajustes*: Bluetooth, adaptador, notificações, localização, localização "o tempo todo", bateria sem restrições e gatilho do carro, com botão de correção.
- Alerta **"GPS sem sinal"** quando o carro anda sem posição por mais de 2 min.
- Gravação de diagnóstico: bateria, carregamento, temperatura, tela e restrições de energia do celular a cada 10 s; eventos `resume`, `gps_lost` e `gps_ok`.

### Alterado
- Varredura de diagnóstico da ECU uma vez por dia por veículo (cada início ficava ~8 s mais lento).
- GPS a cada 2 s em vez de 1 s (a velocidade instantânea vem da ECU), para poupar bateria.

## [0.2.5] - 2026-10-24

Ajustes a partir da primeira viagem gravada (Fiat Uno Vivace, ~900 km, ISO 14230-4 KWP FAST).

### Corrigido
- Perfil do Uno: avanço de ignição (sem o deslocamento SAE de −64° nesta ECU) e STFT (byte com sinal centrado em zero) decodificados corretamente; LTFT (0107) e sonda pré-catalisador (0114) deixaram de ser lidos por não serem confiáveis nesta ECU.
- Consumo negativo e 106 alertas falsos de mistura causados pelos trims mal decodificados; o cálculo de consumo agora limita a correção a ±30%.
- Borboleta normalizada para 0–100% (a ECU informa 11–87%), o que faz o alerta de marcha lenta funcionar.
- Captura iniciada antes da ignição desistia em ~1 min com o motivo "adaptador inacessível": agora espera a ignição por até 5 min ("ignição não detectada").
- Reconexão após queda no meio da viagem: 6 tentativas em vez de 3 (o adaptador reinicia na partida do motor).

### Alterado
- Leituras do Uno redistribuídas para a linha K (~5 leituras/s): RPM, velocidade e MAP na faixa rápida (~0,85 s em vez de ~1,8 s), demais a cada 5 s, diagnóstico a cada 30 s.
- `ATSPA5`: tenta KWP FAST primeiro (conexão em ~1 s em vez de ~5 s).
- Relações de marcha medidas no perfil do Uno, ativando a indicação da marcha engatada.

### Adicionado
- Pedido de localização "o tempo todo", com aviso no painel: uma captura iniciada em segundo plano perdeu o GPS após 24 s.
- Botão para os ajustes do app, com orientação para desativar a economia de bateria em aparelhos Xiaomi.
- Dados reais da ECU em `docs/veiculos/uno-vivace-7gf.md`.

## [0.2.4] - 2026-10-23

### Corrigido
- **Perfil do Fiat Uno Vivace não conectava à ECU**: forçava CAN (`ATSP6`), mas pelo manual a IAW 7GF fala pela linha K (pino 7 do conector OBD). Agora usa busca automática (`ATSP0`) e o protocolo real é lido com `ATDPN`; tempo de busca de 12 s.

### Adicionado
- Descrições dos códigos de falha no perfil (`dtc_descriptions`), exibidas no painel, no histórico de falhas e na notificação de nova falha. O perfil do Uno traz os 26 códigos do manual.
- Alerta de marcha lenta fora do normal no perfil do Uno (especificado 815 ± 50 rpm).
- `docs/veiculos/uno-vivace-7gf.md` com as especificações técnicas do veículo.

## [0.2.3] - 2026-10-23

### Adicionado
- *Histórico*: botão **Apagar** em cada viagem e **Apagar todo o histórico** (viagens, telemetria e falhas registradas), com confirmação. A viagem em andamento é preservada.
- Aviso no painel quando as notificações do app estão desativadas, com botão que abre a configuração do Android.

### Alterado
- Notificação fixa da captura no estilo Radarbot: "Universal OBD em execução", cronômetro da viagem, dados ou estado da conexão, ações **Abrir** e **Encerrar viagem**, visível na tela de bloqueio e com ícone na barra de status (novo canal de prioridade normal, sem som).

## [0.2.2] - 2026-10-23

### Corrigido
- O botão **Apagar** das gravações de diagnóstico não fazia nada, e mensagens do painel (erros de exportação CSV/GPX/diagnóstico, troca de perfil) não apareciam: sem `WebChromeClient` o WebView ignorava `alert()`/`confirm()`. Agora aparecem como diálogos nativos.

## [0.2.1] - 2026-10-23

### Adicionado
- *Ajustes → Bluetooth*: seletor com os dispositivos já pareados no celular (nome e MAC) para escolher o adaptador OBD, e caixas de seleção para marcar os dispositivos-gatilho (ex.: multimídia do carro). Os campos de texto continuam disponíveis para nomes/MACs digitados; "Automático" usa os nomes do perfil (`OBDII`, `OBD2`...).

## [0.2.0] - 2026-10-23

Primeira versão compilada e testada em JVM: simulador de ELM327, correções de protocolo e de queda de ignição, exportação CSV/GPX, gravação de diagnóstico para testes em veículo, CI e releases assinados.

### Adicionado
- **Gravação de diagnóstico** (*Ajustes → Gravação de diagnóstico*): um arquivo JSON Lines por captura em `<filesDir>/diagnostics`, exportável em `.gz` pelo menu de compartilhar. Registra:
  - cada comando ao ELM327 com a resposta bruta, a latência e timeouts/erros (`LoggingTransport`);
  - uma varredura única da ECU no início (`ATI`, `AT@1`, `ATDP`, todos os PIDs do modo 01 anunciados, VIN/calibração do modo 09 e DTCs);
  - eventos de conexão, energia, alertas, DTCs, PIDs desativados e erros, além de um retrato do estado a cada 1 s (leituras, consumo, marcha, GPS).

  Falhas de disco desativam só a gravação; limite de 1 GiB por sessão; arquivos com mais de 30 dias são apagados. Falhas fatais do app viram `crash_<data>.txt` na mesma pasta. Indicador `● REC` no painel.
- **Releases automáticos** (`.github/workflows/release.yml`): a tag `vX.Y.Z` gera o APK assinado e publica em GitHub Releases com as notas do CHANGELOG; valida tag × `versionName`, seção do CHANGELOG e secrets. `v0.*` sai como *pre-release*.
- `scripts/criar-chave-release.sh`: cria a chave de release fora do repositório e mostra os secrets a cadastrar no GitHub.
- **Chave de debug fixa** (`app/debug.keystore`): APKs de debug do CI e de qualquer máquina atualizam uns aos outros sem desinstalar o app (o que apagaria viagens e ajustes).
- Assinatura de release configurável por variáveis de ambiente ou `~/.gradle/gradle.properties` (`RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`); a chave nunca entra no repositório.
- **Exportação de viagens** (aba *Histórico*, botões CSV e GPX), compartilhada pelo menu do Android via `FileProvider`:
  - CSV RFC 4180 com toda a telemetria da viagem; as saídas extras do perfil viram colunas;
  - GPX 1.1 com o trajeto (segmentos quebrados em falhas de GPS > 30 s), RPM/velocidade/temperatura/consumo nas extensões `obd:` e as falhas (DTCs) como waypoints.
- **CI no GitHub Actions** (`.github/workflows/ci.yml`): testes de unidade, lint e APK de debug em todo push no `master` e em PRs; relatórios e APK ficam como artefatos da execução.
- **Simulador de ELM327 em JVM** (`app/src/test/.../obd/sim/Elm327Simulator.kt`): comandos AT, modo 01 a partir de um estado de veículo, bitmaps de PIDs suportados, DTCs CAN (multi-frame ISO-TP) e K-Line, e falhas injetáveis (latência, timeout, `?`, `BUFFER FULL`, ignição desligada, PIDs mudos).
- `CommandQueueSimulatorTest`: 13 cenários do escalonador em tempo virtual (`kotlinx-coroutines-test`), entre eles saturação do adaptador, modo ocioso, queda de ignição, adaptador travado e clones sem sufixo de contagem.
- Interface `ElmTransport`: a `CommandQueue` não depende mais do `BluetoothSerialManager`.
- Gradle wrapper (`gradlew`, `gradle-wrapper.jar`) e esquema exportado do Room (`app/schemas/`), base para futuras migrações.

### Corrigido
- Ignição desligada por poucos segundos (motor apagou, partida) desativava RPM, velocidade, TPS e MAP pelo resto da viagem. Agora o contador de `NO DATA` só desativa um PID se a ECU continua respondendo aos outros.
- Com a ignição desligada e o adaptador energizado, a viagem nunca terminava por silêncio da ECU: o `NO DATA` dos modos 03/07 era contado como resposta e ainda apagava a lista de DTCs da tela.
- Projeto compila pela primeira vez: removido `conflate()` sobre `StateFlow` (deprecado com nível de erro no kotlinx.coroutines 1.9) em `MainActivity` e `TelemetryScreen`.
- Respostas K-Line (ISO 9141/KWP2000) que começam com `BUS INIT: ...OK` eram classificadas como `UNABLE_TO_CONNECT`, impedindo a conexão com o perfil genérico.
- Com busca automática de protocolo (`ATSP0`) o app tratava todo veículo como não-CAN e decodificava DTCs errados (o byte de contagem virava parte do código). O protocolo real agora é lido com `ATDPN` após o `0100`.
- Erro fatal do lint `InvalidFragmentVersionForActivityResult`: dependência explícita de `androidx.fragment:fragment-ktx:1.8.5`.

## [0.1.0] - 2026-10-14

Primeira versão funcional da arquitetura: captura OBD2 em segundo plano, caixa preta em SQLite, Android Auto e perfis de veículo em JSON.

### Adicionado
- **Projeto Android** (Kotlin, Gradle 8.9, AGP 8.7.3, minSdk 26, targetSdk 35), pacote `com.universal.obddashboard`.
- **Perfis JSON agnósticos** (`ProfileParser.kt`): validação na carga, esteiras configuráveis, papéis semânticos (`roles`), PIDs com múltiplas saídas e comandos de fallback; importação de perfis pelo usuário em `<filesDir>/profiles`.
- **Avaliador de fórmulas** compilado para AST: aritmética, operações de bits, comparações, `&&`/`||`, ternário e funções (`abs`, `min`, `max`, `clamp`, `signed8`, `signed16`...).
- **Parser ELM327** (`ElmProtocol.kt`): respostas com ou sem espaços, multi-frame ISO 15765-4, classificação de erros (`NO DATA`, `BUFFER FULL`, `UNABLE TO CONNECT`...), leitura `ATRV` e decodificação de DTC (modos 03/07/0A).
- **Transporte Bluetooth SPP** (`BluetoothSerialManager.kt`) com um comando em voo e fallback de canal RFCOMM para clones.
- **Escalonador de três esteiras** (`CommandQueue.kt`) por prazo mais antigo (EDF): alta (100 ms), média (1,5 s) e sentinela de diagnóstico (10 s); descoberta de PIDs suportados, sufixo de contagem de respostas e modo ocioso.
- **Serviço em primeiro plano** (`ObdForegroundService.kt`) com Partial WakeLock, GPS Fused Location, reconexão, detecção de ignição desligada (silêncio da ECU) e máquina de estados de inatividade (5 min parado → confirmação → encerramento).
- **Início/fim automáticos** por Bluetooth (`AutoDisconnectReceiver.kt`), por dispositivos-gatilho extras e pela sessão do Android Auto.
- **Métricas derivadas** (`TelemetryEngine.kt`): consumo por speed-density ou MAF com correção de fuel trims e mistura flex, nível estimado do tanque, indicador de troca de marcha e alertas com debounce.
- **Caixa preta Room**: tabelas `trips`, `telemetry_log` (amostra a cada 2 s) e `diagnostic_trouble_codes` com freeze frame e coordenadas GPS.
- **Android Auto** (`DashboardCarAppService.kt`, `TelemetryScreen.kt`): grade com RPM, velocidade, temperatura, consumo, tensão e alertas; avisos de alertas críticos na tela do carro.
- **Painel web local** (`assets/web`) via WebView: mostradores, sensores, histórico de viagens e falhas, ajustes de perfil, combustível e Bluetooth.
- **Perfil `fiat_uno_vivace_7gf.json`** (Magneti Marelli IAW 7GF, CAN 11-bit 500 kbps): redline 6250 RPM, faixas térmicas 87/97/103/105 °C, troca econômica 14,8/28,2/43,8/61,4 km/h, tanque de 48 L e 12 alertas.
- **Perfil `generic_obd2.json`** com busca automática de protocolo e PIDs SAE J1979.
- **Testes de unidade** do núcleo (`ObdCoreTest.kt`).
- `CHANGELOG.md` e seção de versionamento no README.

### Alterado
- Formato do perfil do Uno em relação ao rascunho inicial: campos de alerta fixos (`alert_redline`, `alert_fan1`, `alert_low`...) substituídos pela lista genérica `alerts[]` com condições; `ATS0` e `ATAT1` adicionados aos comandos de inicialização.

### Problemas conhecidos
- Projeto ainda não compilado nem testado em dispositivo/veículo.
- Um ELM327 via SPP responde ~10–25 req/s; a esteira de 100 ms roda no melhor esforço.
- `volumetric_efficiency` e `gear_kmh_per_1000rpm` do perfil do Uno precisam de calibração no carro.
- A categoria `IOT` do Android Auto exige "Fontes desconhecidas" para teste e pode não ser aceita na Play Store.
- O `gradle-wrapper.jar` não está no repositório (rode `gradle wrapper` uma vez).

[Não lançado]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.7...v0.3.0
[0.2.7]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AlanMartines/Universal-OBD-Dashboard/releases/tag/v0.1.0
