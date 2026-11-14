# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.9.44] - 2026-11-13

### Adicionado
- **Calibração dos sensores (Ajustes):** card novo que mostra o que o app mediu e aprendeu dos sensores: desvio do giroscópio nesta partida, posição do módulo (qual eixo aponta para cima e para a frente, e se foi zerado à mão), quanto da volta a bússola do ESP32 já calibrou e o ângulo do celular no suporte. Tem um ajuste fino em graus (inclinação frontal, lateral e rumo das bússolas), somado por cima do aprendizado e válido na hora, sem mexer no código quando um módulo vem diferente do outro. Também tem botões para recomeçar cada aprendizado (nível e frente, bússola do ESP32, celular) ao trocar o módulo de lugar. O rumo do GPS não recebe o ajuste. O desvio do giroscópio não tem campo à mão, porque muda a cada vez que o ESP32 liga. Os valores vão ao painel web, num bloco abaixo dos mostradores, ao vivo e na simulação de viagem, e o ajuste fino vai no backup. Nada é enviado ao ESP32 nem ao carro.

## [0.9.43] - 2026-11-13

### Corrigido
- **Desvio do giroscópio do LSM6DS3:** parado, cada chip marca alguns °/s de giro (a folha de dados aceita até ±10 °/s; o módulo testado na bancada marcou cerca de 1,8, −3,0 e −2,3 °/s). Com mais de 3 °/s no total, o app nunca via o carro "parado e quieto", ficava preso em "Calibrando" e o Zerar nível não terminava; em reta, ainda mostraria curva falsa. Agora o desvio de cada eixo é medido em toda parada quieta (velocidade zero e aceleração estável), acompanha a temperatura e é descontado de todas as leituras. O giro só aparece depois da primeira medição.

## [0.9.42] - 2026-11-13

### Adicionado
- **Bússola do celular:** o sensor de rotação do próprio celular vira bússola de reserva para o rumo com o carro parado. O celular fica no suporte em qualquer ângulo: o app aprende a diferença para a frente do carro andando em reta com o GPS e reaprende se o celular for girado (parado ou andando). Com o magnetômetro do ESP32 também lendo e os dois concordando (até 20°), o rumo é a média das duas, com mais peso para a do ESP32; discordando, vale a do ESP32; se uma falha, a outra assume. A origem aparece embaixo do rumo (GPS, bússola, celular ou bússola + celular), também no painel web e no Android Auto.

### Corrigido
- **Dinâmica sem valor falso:** o câmbio mostra "--" (era "–") sem leitura, e a bolinha da força G some junto com o rastro quando o sensor para de ler, em vez de deixar o desenho da última leitura.

## [0.9.41] - 2026-11-13

### Adicionado
- **Tela Dinâmica (app, painel web e Android Auto):** a antiga tela Movimento vira Dinâmica e ocupa a tela toda (as abas continuam embaixo), sempre visível, com as cores do tema escolhido. Traz o horizonte artificial (inclinação frontal e lateral) dentro de uma bússola, o câmbio, o inclinômetro com os picos, a força G com rastro, o ambiente (altitude e pressão) e a curva (lado e giro em °/s). No painel web aparece ao vivo e na reprodução das viagens; no Android Auto, como uma segunda tela de números (o modelo do Android Auto não permite desenho livre).
- **Câmbio P/D/R no lugar da marcha estimada:** P parado, D andando e R de ré, em todos os temas e no Android Auto. A ré sai do sentido da aceleração na arrancada (precisa do LSM6DS3 calibrado). Saem a marcha estimada (1ª a 5ª) e o aviso de troca de marcha (▲ 4ª) da tela, também na aba Detalhes; as luzes de troca do tema Pista seguem só pelo RPM.
- **Inclinação lateral e giro:** o app separa a inclinação lateral da força da curva (velocidade × giro), como já fazia com a frontal e a aceleração.
- **Zerar nível e Calibrar frente:** ajustes à mão do sensor de movimento, que passam a valer no lugar do aprendizado automático. Ficam no app; nada vai ao ESP32 nem ao carro.
- **Bússola:** suporte ao magnetômetro GY-273 (QMC5883L, QMC5883P ou HMC5883L) no firmware 1.5. O app calibra a bússola sozinho pelo rumo do GPS (tabela de desvio por faixa de 10°, que já inclui a declinação). Andando, o rumo vem do GPS; parado, devagar ou sem sinal, da bússola. Se o módulo for mexido, ela percebe e recomeça.
- **Altitude:** pela pressão do BMP180, acertada pela altitude do GPS, com a seta de subida ou descida.

### Alterado
- **Envio ao painel:** até 200 métricas por amostra (eram 120), e o lote é cortado pelo tamanho para nunca passar do limite do servidor (antes um lote grande demais era recusado e pulado). O servidor precisa ser atualizado antes do app.

## [0.9.40] - 2026-11-12

### Adicionado
- **Manutenção no painel web:** o app envia a lista de manutenção ao painel (itens e registros, como os abastecimentos; a observação de cada registro fica no celular). Nova aba Manutenção na página do veículo, com a situação de cada item pelo hodômetro mais recente, o histórico e o gasto registrado, e um aviso no cartão do veículo na página inicial quando algo vence. Edição só no app.

### Alterado
- **Manutenção pela próxima troca que o mecânico passa:** o formulário tem um select com os itens do manual (mais "Outro…"), a última vez (data e km, com o hodômetro atual já preenchido) e a próxima troca em "daqui a X km" ou "no km" e, opcional, "daqui a X meses" ou "na data" (data de hoje ou passada não conta). O "Feito" também pede a próxima troca, sugerindo o intervalo anterior. Sai o card do plano com caixas de seleção. Banco do app na versão 6 (próxima troca no item), sem perder os itens já cadastrados.

## [0.9.39] - 2026-11-11

### Adicionado
- **Resumo ao encerrar a viagem (app):** quando a captura termina, um aviso mostra distância, litros, km/l, custo, duração, tempo andando e parado, velocidade média e máxima, injeção cortada, faixas do econômetro, temperatura máxima do motor e, com o LSM6DS3, a freada, a arrancada e a curva mais fortes e os buracos. Dá para desligar no próprio aviso. O resumo do Histórico ganhou as mesmas informações.

## [0.9.38] - 2026-11-11

### Adicionado
- **Pinagem da tomada OBD2 desenhada pelo projeto:** a da norma SAE J1962, com os pinos de cada protocolo (`docs/img/pinagem-obd2.svg`), e a do Uno Vivace, com o que tem em cada pino e o que o ELM327 e a placa do ESP32 usam. Nos docs e na página /projeto do painel.
- **ELM327 mini detalhado no modelo 3D:** 47 × 24 × 30 mm, com as duas placas por dentro (Bluetooth, PIC18F25K80, cristal, J1/J2 e LEDs que piscam na animação).
- **Saúde do carro ao longo do tempo (painel web, aba Saúde):** leitura dos últimos 14 dias (mistura, bateria, alternador, arrefecimento, catalisador e luz de injeção) comparada com as faixas usuais, e gráficos diários da correção de combustível, tensão, temperatura do motor e oscilação da sonda pós-catalisador, com tabela. O worker monta um resumo diário a cada hora (tabela `health_daily`), que fica guardado mesmo depois que as amostras são apagadas pela retenção.
- **Estado da escuta CAN no app (aba Sensores):** card com o que o ESP32 informa durante a captura: versão do firmware, velocidade da rede, quadros por segundo, quadros contados no ESP32 e recebidos pelo app, perdidos e erros de rede, se o BMP180 e o LSM6DS3 foram encontrados, descanso, erro e reinícios. Antes essas linhas eram descartadas.
- **Lembretes de manutenção (aba Manutenção do app):** itens com intervalo em km e/ou meses, vencendo pelo que chegar primeiro; registro de cada serviço feito (data, hodômetro, custo, oficina) com histórico; situação de cada item (em dia, perto de vencer, vencido) calculada pelo Total do app; e uma notificação por dia ao começar a captura quando algo vence. A lista sugerida vem do plano do manual no perfil do veículo (novo campo `maintenance_plan`; o perfil do Uno Vivace traz o plano do manual do proprietário) ou, sem ele, de uma lista genérica. Banco do app na versão 5 (duas tabelas novas, migração sem perda); o backup já inclui os dados.
- **Placa 3D animada no painel web:** os LEDs (tricolor e o azul do ESP32) piscam no ritmo do firmware 1.4, com botões para cada estado; a caixa abre e fecha devagar ao trocar de modo; o modelo gira sozinho até um toque; e pulsos de luz correm pelos fios e trilhas (rápidos nos de dados, lentos na alimentação, nada no GND). Com a opção de reduzir movimento do sistema, o giro e os pulsos começam desligados.

## [0.9.37] - 2026-11-10

### Adicionado
- **Firmware do ESP32 (esp32-can-listen 1.4): LEDs de estado.** O LED azul da placa do ESP32 pisca 1 vez por segundo sem o app ou sem quadros da rede, 2 vezes capturando, rápido no erro, e apaga no descanso. Um LED tricolor externo, opcional, mostra o mesmo só com as cores puras (azul sem o app, verde com o app, vermelho no erro), com o comum no D18: o firmware o põe em 3,3 V ou 0 V, então a mesma ligação serve para anodo e catodo comum (`LED_ANODO_COMUM`).
- **Placa e caixa:** conector do LED tricolor na linha 1 e dois furos na tampa, um para ver o LED azul do ESP32 e outro para o LED tricolor.
- **Caixa de proteção da placa da escuta CAN, para impressora 3D.** Base e tampa em STL (prontas para fatiar), o mesmo modelo no OpenSCAD e um desenho com as cotas ao lado do esquema. Mede 75 × 86,5 × 29,5 mm por fora e serve para as duas versões da placa. Tem tampa com 4 parafusos M3, abas para prender no carro (furo para parafuso M4 e fenda para abraçadeira de nylon de até 5 mm), abertura para o USB do ESP32 e passagem para o cabo OBD. O LSM6DS3 e o BMP180 ficam dentro, cada um preso num apoio do fundo; dentro da caixa, a temperatura do BMP180 tende a ficar alguns graus acima da do carro.
- **Placa 3D no painel:** botões Sem caixa, Dentro da caixa (tampa transparente) e Fora da caixa (vista explodida).
- **Placa 3D no painel: o kit completo.** O adaptador ELM327 mini e o cabo Y OBD2 (um macho e duas fêmeas, de cabo chato) aparecem soltos atrás da placa, numa camada própria. A legenda dos fios começa recolhida.

### Alterado
- **Placa, versão com o SN65HVD230:** a medida entre CANH e CANL deu 120 Ω, então o R2 ("121", terminação) do módulo sai. Desenho, modelo 3D e instruções sem ele.
- **Placa da escuta CAN: módulos encaixados.** O transceptor (TJA1050 ou SN65HVD230) e o RT8272 vão em barras fêmea, como o ESP32, e saem sem solda para trocar. No TJA1050, o CANH e o CANL vão por dois fios curtos até um conector de 2 vias na linha 24, com as ligações de baixo refeitas.
- **Placa 3D:** o LSM6DS3 e o BMP180 passaram para a direita da placa, nas posições que ocupam dentro da caixa, com os cabos correndo perto do fundo.

### Corrigido
- **Aviso "Escuta CAN (ESP32) não conectou" no meio da viagem.** Ele aparecia também quando o ESP32 já tinha conectado e caía depois, por exemplo ao desligar o carro com o ESP32 na USB da multimídia. Agora só pergunta no começo da captura (até 1 min), se o ESP32 ainda não conectou nenhuma vez; depois, a queda só aparece na etiqueta "CAN · sem conexão".
- **Encerrar a captura deixava o CAN "conectado" e o botão preso em "Encerrar".** O encerramento terminava, mas, ao fechar o Bluetooth do ELM327, o aviso de desconexão do Android chegava ao serviço que estava parando e o mantinha de pé, sem captura; novos toques em Encerrar eram ignorados. Agora esse aviso é ignorado durante o encerramento, um aviso que chega sem captura não segura o serviço, e tocar em Encerrar de novo termina o serviço se ele tiver ficado de pé. Além disso, o OBD e o CAN aparecem parados na hora, as duas conexões Bluetooth (ELM327 e ESP32) fecham já, o botão mostra "Encerrando…" e a espera pelas tarefas da sessão tem limite de 3 s.

## [0.9.36] - 2026-11-10

### Adicionado
- **Firmware do ESP32 (esp32-can-listen 1.3): sensor LSM6DS3 opcional.** Lê o acelerômetro e o giroscópio no mesmo I2C do BMP180 (D25/D26), a 50 Hz, e manda a cada 200 ms a média do intervalo e o maior desvio da gravidade: `# lsm6ds3 ax=… ay=… az=… gx=… gy=… gz=… pico=…`. Serve o LSM6DS3 e o LSM6DS3TR-C, em 0x6A ou 0x6B. Sem o sensor, segue igual; no descanso, ele também desliga.
- **Tela Movimento** (APK e painel web), com o LSM6DS3 do ESP32: aceleração e frenagem, força nas curvas, inclinação da rua, impacto, buracos da viagem e as máximas (frenagem, arrancada e curva). O módulo pode ficar em qualquer posição: o app aprende sozinho o "cima" com o carro parado e a frente nas arrancadas e frenagens, comparando com a velocidade do OBD, e salva essa orientação (vai no backup). Enquanto aprende, os campos dizem o que falta fazer. A aba só aparece depois da primeira leitura do sensor.
- **Painel web, grupo Movimento:** os mesmos valores, mais a leitura bruta dos eixos do módulo. Os valores calculados também vão para o histórico das viagens.

### Alterado
- **Rodapé dos mostradores:** a temperatura interna e a pressão do ar do BMP180 aparecem juntas e discretas ao lado do relógio (`09:54  27°C · 1.010 hPa`), em todos os temas, no APK e no painel web. Sem o sensor, o campo some.

### Corrigido
- **Marcha com várias casas decimais ao rever a viagem no painel web** (por exemplo "2.7931…ª" e, no aviso de troca, "▲ 4.48…ª"). A reprodução preenche os intervalos entre os pontos gravados para os ponteiros andarem suaves e fazia isso também com a marcha. Agora os valores em degraus (marcha, marcha sugerida, aviso de troca, etapa do sensor de movimento, buracos e faixa de economia) ficam no último valor gravado, e os mostradores arredondam a marcha em todos os temas.

## [0.9.35] - 2026-11-09

### Adicionado
- **Vácuo do coletor e desvio do sensor MAP**, com o BMP180 do ESP32. O vácuo é a pressão atmosférica menos o MAP, com o motor ligado. O desvio do MAP é a diferença para o sensor ambiente, medida com a chave ligada e o motor parado. Os dois vão para o histórico e para o painel web (grupo Motor). O desvio é só diagnóstico: o consumo não é corrigido por ele, porque a calibração pelos abastecimentos já absorve o erro médio.
- **Placa 3D:** o sensor BMP180 (GY-68) aparece na ponta do cabo, com os conectores e os fios de cada sinal, e ganhou caixa própria para esconder ou mostrar.

### Alterado
- **Carga estimada pelo coletor:** com o BMP180, usa a pressão atmosférica ao vivo. Funciona mesmo se a captura começar com o motor ligado e acompanha a altitude numa subida de serra. Sem o sensor, continua com a pressão lida com o motor parado.
- **Mostrador do coletor:** as faixas "vácuo alto", "carga parcial" e "carga plena" passam a ser relativas à pressão atmosférica, e a nota mostra o vácuo.

### Corrigido
- **Temas Clássico e Horizonte:** "Trip" mostrava a distância calculada nesta captura. Agora mostra o parcial do painel do carro, lido pela escuta CAN (`trip_km`). Sem a escuta, o rótulo vira "Viagem" e continua mostrando a distância da captura. Vale para o APK e para o painel web.

## [0.9.34] - 2026-11-08

### Adicionado
- **Painel web: área pública do projeto.** `/projeto` (apresentação), `/sobre` (propósito: dar uma central de informações moderna a carros sem painel de verdade, só com o que a rede do carro oferece) e `/projeto/placa` (placa da escuta CAN em 3D, com Three.js local, peças detalhadas e o nome de cada uma ao passar o mouse). Abrem sem login e levam ao GitHub.
- **Placa da escuta CAN:** modelo 3D (navegador e OpenSCAD) gerado com as mesmas posições do desenho, fusível mini de 1 A em suporte na placa, e CANH/CANL do TJA1050 por pernas curtas com as ligações por baixo.
- **Firmware do ESP32 (esp32-can-listen 1.2): sensor BMP180 opcional.** Lê a temperatura e a pressão no I2C (SDA no D25, SCL no D26) a cada 5 s, numa linha de estado `# bmp180 temp=… pressao=…`. Sem o sensor, segue igual. A leitura é direta, sem biblioteca.
- **Temperatura interna no painel:** com o BMP180 no ESP32, o app mostra a temperatura ao lado do relógio, no rodapé de todos os temas, e grava temperatura e pressão no histórico (`cabin_temp`, `cabin_pressure`). O painel web mostra o mesmo e lista as duas em Ambiente.
- **Firmware do ESP32 (esp32-can-listen 1.1): modo descanso.** Depois de 2 min sem quadros na rede, desliga o Bluetooth e o TWAI e entra em sono leve. Acorda com o primeiro sinal da rede no RX e volta a escutar em cerca de 2 s. Assim o ESP32 pode ficar ligado no OBD o tempo todo, com consumo estimado em torno de 10 mA em descanso. Nada é enviado à rede para acordá-la.

## [0.9.33] - 2026-11-07

### Adicionado
- **Painel: três temas novos.** Pista (conta-giros em setores, marcha no miolo e luzes de troca), Clássico (dois mostradores redondos com aro metálico e ponteiro curto) e Horizonte (arco largo de RPM em ciano, com a velocidade no centro). Cada um tem modo dia e noite.
- **Cápsula: botão de cor** no rodapé, que alterna entre verde e vermelho. A escolha fica gravada e vai no backup.
- **Histórico da viagem com os cálculos do app:** km/l, média, combustível usado, litros no tanque, marcha, sugestão de troca e folha de economia. Assim o painel web reproduz a viagem como ela apareceu no app.
- **Painel web: simulação de viagem.** Na aba Viagens, o botão ▶ reproduz a viagem nos mostradores em 1×, 5× ou 16×, com linha do tempo. Nas viagens antigas, km/l, média, combustível e tanque são refeitos a partir das leituras gravadas.

### Alterado
- **Cápsula:** o preenchimento ganhou cor única, fraca no início da escala e forte no topo, com um traço claro no valor atual. Os números perderam o contorno grosso.
- **Minimal e Pista:** Viagem e Tempo saíram do rodapé e foram para dentro do tema.
- **Painel web:** o Total (km) aparece nos mostradores.

## [0.9.32] - 2026-11-06

### Corrigido
- **Topo do app:** ao abrir com a captura parada, as etiquetas às vezes não apareciam (ficava só "Parado", sem a do CAN). A tela agora pede o estado atual ao carregar.
- **Etiqueta do OBD:** sempre identificada ("OBD · Parado", "OBD · Capturando"…), com ou sem a Escuta CAN; a do CAN aparece só com a escuta em uso.

## [0.9.31] - 2026-11-06

### Corrigido
- **Backup completo:** agora leva toda a configuração, menos as chaves:
  - a configuração da IA (ligada ou não, provedor, endereço, modelo e permissões de envio);
  - o endereço do painel, o envio ligado e a opção de GPS de cada veículo;
  - as preferências da tela: tema do app, visual e modo dia/noite dos mostradores.
- Continuam de fora, por segurança, a chave de API da IA e o pareamento com o painel. Depois de restaurar, o resumo diz o que falta: colar a chave e parear de novo (no painel, Dispositivos → novo código).

## [0.9.30] - 2026-11-06

### Alterado
- **Identificador do app:** passa a ser `br.com.eletroinfotecnologia.universalobd` (domínio da Eletro Info invertido), já pensando na publicação na Play Store.

### Atenção: migração
Com o identificador novo, o Android trata o app como **outro app**: o APK da v0.9.30 instala ao lado do atual, sem atualizar, e os dados não passam sozinhos. Para migrar:
1. No app atual, **Ajustes → Backup completo → Gerar backup**.
2. Instale a v0.9.30 e, nela, **Ajustes → Backup completo → Restaurar backup…** com o arquivo gerado.
3. Se usa o painel web, pareie o app novo de novo.
4. Confira as viagens e os ajustes e desinstale o app antigo.

### Painel web (já no ar)
- Menu lateral com foto maior, "Online" e rodapé com Meus Dados, Sessões, Tema e Sair; sessões em cartões com nome do aparelho e expiração.
- Meus Dados em `/meus-dados` (o endereço antigo redireciona) e verificação em duas etapas mais clara.

## [0.9.29] - 2026-11-06

### Adicionado
- **Topo do app com duas etiquetas:** OBD (ELM327) e CAN (ESP32: conectado, conectando, sem conexão ou desligado). Sem escuta CAN configurada, fica só a etiqueta de sempre.
- **Aviso quando o ESP32 não conecta:** 10 s depois de iniciar, pergunta se encerra ou continua só com o OBD; fecha sozinho se ele conectar. A notificação da captura mostra "CAN sem conexão".
- **Painel web:** percurso encaixado nas ruas (OSRM no próprio servidor, opcional) e percurso ao vivo.

### Alterado
- **Ajustes:** o card Escuta CAN (ESP32) vem logo depois do Adaptador OBD.

## [0.9.28] - 2026-11-05

### Corrigido
- **Tanque depois do abastecimento:** com a escuta CAN, o ponteiro do painel (amortecido, só sobe com o motor ligado e leva ~40 min para alcançar o tanque cheio) desfazia o tanque cheio registrado e a autonomia ficava errada. Agora o nível informado vale até o ponteiro alcançá-lo, e um ponteiro subindo só aumenta a estimativa.
- **Captura parando no posto:** depois de desligar e religar a chave, a central parava de responder ao ELM327 e a captura era encerrada como "ignição desligada". Com a rede CAN ativa, o app agora reconecta.

## [0.9.27] - 2026-11-05

### Alterado
- **App: avisos** empilhados (até 3, o mais novo embaixo), com ícone pelo tipo e barra do tempo restante; tocar fecha, arrastar para o lado dispensa e segurar pausa.
- **Painel web: avisos** no mesmo desenho do app (sucesso, erro, aviso e informação), embaixo no celular e no canto inferior direito a partir do tablet, com pausa ao passar o mouse.
- **Painel web: confirmações** com ícone e cor pela gravidade: vermelho para excluir, amarelo para revogar, desativar, encerrar e remover, verde para entrar no modo suporte.

### Corrigido
- **Painel web:** o contorno verde dos campos em foco e o brilho verde do fundo não apareciam (cor escrita em formato inválido no CSS).

## [0.9.26] - 2026-11-05

### Adicionado
- **App: tema claro e automático** em Ajustes → Aparência (escuro continua o padrão; o automático fica claro das 6 h às 18 h). Os mostradores da aba Painel mantêm o dia e a noite próprios.

### Alterado
- **App: acabamento visual:** abas em pílula, cards com borda e sombra leve, título dos cards em versalete, botões e campos com 44 px de toque, foco visível e retorno ao toque; animações desligadas com a opção de reduzir movimento do Android.
- **Painel web:** verde do app no lugar do azul do Bootstrap (botões, links, abas, menu, foco, paginação) e, no tema escuro, fundo e cartões com as cores do app.

### Corrigido
- **App:** link "Ver na aba Falhas" com o azul-padrão do navegador, espaço duplo abaixo do RPM, botão "Zerar" do Parcial A quase invisível, campo "Data e hora" do abastecimento sem estilo e botão "Salvar" do hodômetro desalinhado.

## [0.9.25] - 2026-11-05

### Corrigido
- **App, aba Detalhes:** o cartão "Computador de bordo" ficava colado nos cartõezinhos de cima no celular em pé; agora tem o mesmo espaço dos outros cards.

### Alterado
- **Build:** Android Gradle Plugin 9.5.0 e KSP 2.3.13 (Dependabot).

## [0.9.24] - 2026-11-05

### Adicionado
- **Painel web: cartão "Computador de bordo" ao vivo** na visão geral do dispositivo: km/l agora (ou L/h parado), R$/km, folha de eficiência, médias da viagem, desde o abastecimento, parcial A e últimas viagens, autonomia até a reserva e até vazio, e tempo andando, marcha lenta, injeção cortada e % no verde, meio e vermelho. Sem transmissão, o "agora" e a folha ficam em "—"/"sem leitura"; médias e autonomia mantêm o último valor.
- **App:** a leitura ao vivo envia o computador de bordo (métricas `pc.*`), calculado pela mesma rotina da tela do app (`TripComputerStore`).

### Corrigido
- **Painel do veículo (site):** a cópia dos mostradores do app (`dash.js`/`dash.css`) não tinha a folha de economia da v0.9.23; agora tem, e a folha acende com o dado do app.

## [0.9.23] - 2026-11-05

### Adicionado
- **Computador de bordo (aba Detalhes):**
  - **agora:** km/l andando, ou L/h parado com o motor ligado, com R$/km;
  - **eficiência:** selo "Econômico", "Na média" ou "Gastando", com o mesmo critério do indicador de economia (meio do perfil, `eco_mid_l_per_100km`);
  - **médias:** da viagem, desde o abastecimento, do parcial A (zerado pelo botão) e das últimas viagens (~50 km). O abastecimento ou o parcial A no meio de uma viagem contam só o resto dela;
  - **autonomia:** até a reserva e até vazio, pela média e pelo nível do tanque, dizendo qual média usou;
  - **viagem:** tempo andando e velocidade média, marcha lenta (tempo, litros e R$), km com a injeção cortada e % do tempo no verde, meio e vermelho. Numa viagem retomada, as contas continuam pelas amostras gravadas.
- **Indicador de economia (folha aberta, desenho do projeto) no Painel:** verde quando econômico, na cor do texto na média e vermelha com consumo alto; apagada parado ou sem leitura. Fica entre a marcha e a velocidade no Minimal, antes do combustível na Cápsula e depois do combustível no HUD. O selo do computador de bordo usa a mesma folha.
- **Histórico → Resumo** de cada viagem, refeito pelas amostras gravadas: km/l, litros, R$ e R$/km, tempo andando, velocidade média, marcha lenta, injeção cortada e % no verde, meio e vermelho.

### Alterado
- **km/l instantâneo suavizado** (cerca de 3 s), para o número não pular a cada leitura.

## [0.9.22] - 2026-11-05

### Adicionado
- **Roteiro de captura: grupo "Abastecimento"**, com os passos "Antes de abastecer" e "Depois de abastecer" (60 s parado com a ignição ligada e o motor desligado). As marcas mostram, no arquivo de diagnóstico, o nível do tanque antes e depois, e o passo final lembra de registrar o abastecimento.

### Alterado
- **Painel web, sem transmissão:** os valores que só valem com o motor rodando (velocidade, rotação, consumo, carga, MAP, borboleta, avanço, ajuste de mistura e sonda) aparecem como "—", e os cartões grandes como "sem leitura", em vez dos zeros do último instante. Tanque, hodômetro, parcial, temperaturas e tensões continuam com o último valor.
- **Ajustes → Captura: opção de 45 min** em "Encerrar depois de parado por" e em "Continuar a mesma viagem se recomeçar em até", entre 30 min e 1 hora.
- **Roteiro de captura: estrela (★) só nos dados que quase todo carro informa** (referências, rotações, eletroventilador, lanterna, farol baixo, ar-condicionado e abastecimento). Porta, cinto, pedal de freio, freio de mão, ré e farol alto passam a opcionais.

## [0.9.21] - 2026-11-04

### Corrigido
- **Hodômetro sempre atualizado pela escuta CAN.** O Total do app só pegava o hodômetro do painel do carro no começo da captura; agora acompanha cada km novo. Em Ajustes, o campo Hodômetro se atualiza sozinho durante a captura, com o aviso "Atualizado sozinho pelo painel do carro", e continua editável. Cada acerto fica no arquivo de diagnóstico (evento `odometer_sync`).

### Adicionado
- **Novo abastecimento com o hodômetro já preenchido:** o do painel do carro durante a captura, ou o Total do app. Dá para corrigir à mão antes de salvar.

## [0.9.20] - 2026-11-04

### Alterado
- **Roteiro de captura: indicador de economia em cards.** Um card vermelho (alto, médio, baixo), o meio e um card verde (baixo, médio, alto), como as posições do ponteiro. O passageiro toca a posição sempre que ela muda, e o passo termina em "Finalizar teste", sem contador. Novo formato de passo `zones` (grupos de botões coloridos) para qualquer roteiro.
- **Roteiro de captura:** os passos com botões (eventos e grupos) terminam em "Finalizar teste".

## [0.9.19] - 2026-11-04

### Adicionado
- **Escuta CAN do Uno Vivace: consumo da injeção** (`can_fuel_lph`, do `0x281` b4 × 0,66 L/h). Ainda provável: bateu com o consumo calculado em quatro viagens; aparece em Sensores, nas exportações e no painel web, sem substituir o cálculo atual.
- **Roteiro de captura: passos do passageiro, com o carro andando.** O primeiro é o "Indicador de economia": o passageiro toca a posição do ponteiro e o app grava junto a velocidade e a temperatura. Os demais passos continuam só com o carro parado.

### Alterado
- **Roteiro de captura:** o passo "Rotações fixas" não pergunta mais o indicador de economia, que não se move com o carro parado.

## [0.9.18] - 2026-11-04

### Adicionado
- **Roteiro de captura: botão "Testar voz e vibração"**, que fala "liga" com vibração forte e "desliga" com vibração curta, para conferir antes de começar. A lista explica a estrela (★ = passo prioritário).

### Corrigido
- **Roteiro de captura: passos de liga e desliga sem tempo.** Os tempos e repetições iguais ao padrão (10 s, 3 vezes) não chegavam à tela: aparecia "undefined s" e o passo não terminava sozinho.

## [0.9.17] - 2026-11-04

### Adicionado
- **Roteiro de captura (Ajustes → Gravação de diagnóstico):** passos guiados por voz e vibração para mapear a rede de qualquer carro, com o ESP32: portas, cintos, pedais, freio de mão, ré, luzes, limpadores, ventilação, ar-condicionado, rotações fixas, indicador de economia e eletroventilador. Início manual, fim automático, e cada "liga" e "desliga" vira uma marca no arquivo de diagnóstico, no mesmo relógio dos quadros. Só roda com o carro parado e a captura gravando, mantém a captura e a tela ligadas, e não envia nada ao carro. Roteiro genérico em `capture-scripts/generic.json`; um perfil pode trazer o próprio.
- **`tools/can-capture/roteiro_app.py`:** lê o .gz exportado e mostra, para cada passo, os bits que acompanharam a ação.

## [0.9.16] - 2026-11-04

### Adicionado
- **Painel web: aviso de leitura antiga na visão geral.** Quando o veículo não está enviando, os cartões ficam esmaecidos e um aviso informa a data e a hora da última leitura, para não parecer tempo real.
- **Painel web: nomes dos sinais da escuta CAN** (Velocidade, Rotação, Temperatura do motor e Tensão da bateria "do painel", e Nível do tanque), cada um no seu grupo. A tensão ganhou o grupo Elétrica.

### Alterado
- **Painel web:** os itens de cada grupo da visão geral seguem uma ordem fixa, e não mais a ordem de chegada dos sinais.

### Corrigido
- **Nível do tanque zerado no fim da viagem (Uno Vivace):** nos últimos segundos antes de a ignição desligar, o painel do carro envia o nível em 0%. O perfil passa a descartar 0%, e a última leitura deixa de mostrar o tanque vazio.
- **Painel web: títulos das colunas de ação** em Usuários, Sessões ativas, Dispositivos e Viagens. Na aba Viagens, o título da coluna não aparecia.

## [0.9.15] - 2026-11-04

### Adicionado
- **Escuta CAN do Uno Vivace: rotação, temperatura do motor e tensão da bateria** (`can_rpm`, `can_coolant_temp` e `can_voltage`, dos quadros `0x281` e `0x3E0`). Confirmados contra o ELM327 em duas viagens com os dois adaptadores ligados juntos. Aparecem no "Testar (15 s)", em Sensores e nas exportações, sem substituir as leituras do ELM327.

### Documentação
- **Notas do Uno:** comparação entre o ESP32 e o ELM327 (diferenças, atraso de 400–500 ms da linha K) e a ligação por pinos que deixa os dois adaptadores juntos sem cabo Y.

## [0.9.14] - 2026-11-04

### Adicionado
- **Painel web: modo escuro.** Claro, escuro ou automático (segue o sistema), escolhido pelo botão no menu ou na barra superior e lembrado no navegador. O gráfico do histórico e o mapa do percurso acompanham o tema.
- **Painel web: página inicial com um cartão por veículo,** com a situação (ao vivo ou há quanto tempo chegou a última leitura), as falhas ativas, o consumo real, o gasto do mês, o hodômetro e atalhos para os detalhes, o Painel do veículo e as falhas.
- **Painel web: tela do dispositivo em abas,** Visão geral, Histórico, Percurso, Viagens, Abastecimentos e Falhas, com o endereço de cada aba (ex.: `#falhas`).
- **Painel web: aba Viagens,** montada das leituras enviadas: duração, distância, combustível, consumo, velocidade e temperatura máximas, com atalho para ver a viagem no mapa.
- **Painel web: aba Falhas,** com cada código enviado pelo app, a descrição genérica da norma SAE (a mesma tabela do app), se ainda está ativo e quando apareceu.

### Alterado
- **Painel web no celular:** uma barra superior com o menu, o título da página e o tema substitui o botão flutuante, que cobria o conteúdo ao rolar.
- **Painel web: acabamento,** com escala de espaçamento e sombras nos tokens, cantos mais arredondados, transições curtas (desligadas com movimento reduzido), estados vazios com ícone e as telas de entrar, cadastro e senha num cartão centralizado.

### Corrigido
- **Versão do app no painel web:** o app envia a versão instalada na leitura ao vivo, e o cabeçalho do dispositivo deixa de mostrar a versão do dia do pareamento.
- **Hodômetro no cartão do veículo (painel web):** o app passa a enviar o Total (hodômetro informado em Ajustes mais as viagens desde então) na leitura ao vivo, e o servidor guarda o último valor. O hodômetro do painel do carro, pela escuta CAN, tem prioridade. Sem nenhum dos dois, o cartão mostra o do último abastecimento, marcado como tal. Migração 008.
- **Painel web depois de uma atualização:** os endereços dos CSS e JS do painel ganham a versão da publicação. O navegador busca os arquivos novos sozinho, sem precisar de Ctrl+F5, e a página não aparece mais com o estilo antigo.

## [0.9.13] - 2026-11-04

### Adicionado
- **Enviar ao painel (Abastecimentos):** botão que envia na hora a lista de abastecimentos do veículo, com uma linha que diz se o painel está atualizado ou se há alterações aguardando envio.

### Alterado
- **Abastecimento apagado no app:** o painel web guarda o registro por 30 dias, marcado como "Removido no app" e fora das contas de consumo e gasto, e depois o apaga de vez. Se o registro voltar à lista, deixa de estar removido. Migração 007.

## [0.9.12] - 2026-11-04

### Adicionado
- **Quadros brutos do ESP32 na gravação de diagnóstico:** com a gravação ligada, cada linha recebida da escuta CAN vai para o mesmo arquivo do tráfego do ELM327, no mesmo relógio, junto com o estado da conexão. Uma única captura permite comparar as duas fontes.

## [0.9.11] - 2026-11-04

### Adicionado
- **Escuta CAN no app (ESP32):** em Ajustes → Escuta CAN, cada veículo pode ter um adaptador de escuta, que roda ao lado do ELM327 durante a captura. Os sinais vêm da nova seção `can_listen` do perfil e aparecem como as outras leituras, em Sensores, na gravação e nos alarmes. O nível do tanque, medido com o carro parado, corrige a estimativa de combustível restante, e o hodômetro do painel vira a referência do Total. O botão "Testar (15 s)" mostra o que chega, sem captura. Só leitura: o app não envia nada ao adaptador.
- **Perfil do Uno Vivace:** velocidade, nível do tanque, hodômetro e parcial pela rede CAN.

## [0.9.10] - 2026-11-03

### Alterado
- **Ler falhas agora:** o botão só fica ativo quando a leitura pode acontecer. Durante a captura, com o adaptador conectado à injeção. Sem captura, com o Bluetooth ligado e o adaptador do veículo pareado. Ao lado, um texto diz o que falta.

## [0.9.9] - 2026-11-03

### Adicionado
- **Abastecimentos no painel web:** o app envia a lista de abastecimentos do veículo ao servidor quando ela muda, com edições e exclusões. O dispositivo mostra o consumo real, o custo por km, o gasto do mês, os últimos registros e o consumo medido. O nome do posto e as observações ficam só no celular.

### Corrigido
- **Abastecimento cheio ou parcial:** a caixa "Tanque cheio" vinha marcada e um toque a mais a deixava marcada de novo. Agora a escolha entre "tanque cheio" e "parcial" é obrigatória, sem opção pronta, e o aviso confirma como ficou gravado.

### Adicionado
- **Editar abastecimento:** o botão Editar preenche o formulário com o registro, que é atualizado ao salvar. O nível estimado do tanque não muda, para o abastecimento não contar duas vezes.

## [0.9.8] - 2026-11-03

### Adicionado
- **Ler falhas agora (aba Falhas):** consulta na hora as falhas confirmadas, pendentes e permanentes, a luz da injeção e o freeze frame, com ou sem captura. Sem captura, conecta ao adaptador só para isso. Só leitura: nenhum comando apaga falhas.
- **Aviso ao salvar:** toda ação de salvar mostra um aviso rápido na tela.
- **Alertas no painel web:** a leitura ao vivo leva os alertas ativos do app, que aparecem no Painel do veículo. Eles não são guardados no servidor.
- **Meus alarmes:** mostra quantos alarmes a captura em andamento carregou e quantos estão disparados.

## [0.9.7] - 2026-11-02

### Adicionado
- **Meus veículos (Ajustes → Veículo):** vários carros no mesmo celular, cada um com nome, placa opcional e perfil do modelo. Hodômetro, nível do tanque, etanol, adaptador, gatilhos Bluetooth, mostradores, alarmes, tempos, calibração do consumo, viagens, abastecimentos, falhas e telemetria remota ficam separados por veículo. Conectar o adaptador cadastrado em outro veículo troca o veículo antes da captura.
- **Aba Falhas:** falhas ativas e pendentes com descrição e botão "Analisar com IA", monitores de prontidão e o histórico com freeze frame. Só leitura: o app não apaga falhas.
- **Descrição de códigos genéricos:** tabela própria em português com cerca de 190 códigos da norma SAE e o grupo de qualquer outro código. A descrição do perfil do veículo continua com prioridade.

### Alterado
- **Banco v4:** viagens, falhas e abastecimentos ganham o veículo. O que já existe passa para o primeiro veículo, criado com os ajustes atuais.
- **Telemetria remota por veículo:** cada carro tem o próprio pareamento com o servidor. O pareamento atual continua com o primeiro veículo.

### Alterado
- **Pasta `veiculos/`:** dados e ligações de cada carro ficam separados, com modelo para novos veículos. A ligação do Uno Vivace deixa de aparecer como padrão no guia de escuta CAN.

## [0.9.6] - 2026-11-01

### Adicionado
- **Carga estimada:** calculada pela pressão do coletor sobre a atmosférica, para ECUs cuja carga informada não acompanha o motor.
- **Sugestão da correção da velocidade:** compara GPS e ECU em trechos estáveis do histórico e propõe o valor em Ajustes → Mostradores.
- **Meus alarmes:** alarmes por sinal e limite, por perfil.
- **Desempenho:** melhor e último tempo de 0–60, 0–100, 40–60, 60–80 e 80–120 km/h, medidos durante a captura.
- **Custo da viagem:** estimado pelo combustível usado e o preço do último abastecimento.

## [0.9.5] - 2026-11-01

### Adicionado
- **Ajustes → Mostradores:** velocidade máxima, RPM máximo, início da faixa vermelha e correção da velocidade exibida, salvos por perfil.
- **Painel web:** guarda as escalas do dispositivo e abre com elas mesmo com o app fechado.

### Corrigido
- **Avanço de ignição (Uno Vivace):** a leitura de 63,5° enviada pela ECU em baixa carga deixa de ser registrada.

## [0.9.4] - 2026-11-01

### Adicionado
- **Painel do veículo no servidor:** os mostradores Minimal, Cápsula e HUD do app, em tempo real no painel web.
- **Leitura ao vivo no app:** durante a captura, envia uma leitura por segundo com alguém olhando e uma a cada 10 s sem ninguém. Ela não é gravada no servidor.
- **Dispositivos:** adicionar em modal, que espera o app se conectar, e botão de visualizar nas ações.

### Corrigido
- **Selo do dispositivo:** agora mostra "Ao vivo" ou "Sem dados há X" pela idade da última leitura. Antes, "Conectado" indicava só a ligação do navegador com o servidor.

## [0.9.3] - 2026-11-01

### Adicionado
- **Telemetria remota no app** (*Ajustes → Telemetria remota*): envia as leituras a um servidor próprio, com pareamento por código de uso único. Fica desligada até parear. VIN não é enviado, e o GPS tem opção própria, desligada por padrão. Sem sinal, os dados ficam guardados e sobem depois.
- **Servidor de telemetria** (`server/`): painel web, API, PostgreSQL, envio de e-mail e tarefas periódicas em serviços separados, com Docker Compose.
  - Três perfis: Super Admin, Admin (dono da conta) e Usuário de atendimento, que só visualiza.
  - Login por usuário ou e-mail, verificação em duas etapas, sessões ativas, redefinição de senha e modo suporte.
  - Dispositivos com dados ao vivo, histórico em gráfico e paginação.

### Adicionado
- **Sessão guiada de escuta CAN** (`tools/can-capture/roteiro.py`): um menu leva por cada etapa no carro, na ordem ou uma de cada vez. As etapas são a conferência do cabo, as tensões dos pinos 6/14 (com o diagnóstico do tipo de rede), a montagem, o teste de recepção, as ações, o hodômetro antes e depois de uma volta e a desmontagem.
  - Cada teste de ação mostra o início e o fim, e cada etapa pede uma coisa só: você faz a ação, tecla Enter e o roteiro lê sozinho por 5 s.
  - O comando `leituras` do `can_capture.py` mostra o que mudou de uma leitura para a seguinte em cada teste.
  - Refazer e pular ficam registrados, e nenhuma gravação sobrescreve outra.
  - As anotações vão para `anotacoes.txt`.
- **Firmware de escuta CAN para ESP32** (`firmware/esp32-can-listen`): TWAI em listen-only a 50 kbit/s, sem fila de transmissão, com saída por USB e Bluetooth clássico no mesmo formato do Arduino. Ainda não testado no carro.
- **Diagramas de ligação** em `docs/can-escuta.md`: o de teste, com Arduino e MCP2515, e o previsto para o projeto final, com ELM327 e ESP32 no cabo Y.

- **Mapa da rede CAN do Uno** em `docs/veiculos/uno-vivace-7gf.md`: hodômetro total, parcial e luzes confirmados; RPM, temperatura, tensão e combustível ainda como candidatos.

### Corrigido
- **Ligação da escuta CAN no Uno:** só o CAN-L (pino 14), com o CANH polarizado em 3,3 V por 1 kΩ. Com a ligação direta nos pinos 6 e 14, nenhum quadro chegava. Diagrama, guia e lista de montagem do roteiro foram atualizados.
- **Roteiro da escuta CAN:** o CAN-L (pino 14) na tensão da bateria com a ignição desligada passa a ser lido como a rede tolerante a falhas dormindo, e não mais como "fora do esperado". Essa é a assinatura medida no Uno. CAN-H e CAN-L invertidos agora ganham um aviso próprio.
- **Teste de recepção da escuta CAN:** só quadros válidos contam. Antes, uma linha corrompida virava "1 quadro" e o teste dizia "Recepção ok" sem ter recebido nada. O que ficou acumulado na porta também é descartado ao abrir.

### Problemas conhecidos
- **Android Auto por APK:** o README e o `docs/android-auto.md` agora explicam que, a partir do Android Auto 17.7, *Fontes desconhecidas* não libera mais apps da Car App Library instalados por APK. Por isso, o APK das Releases não aparece na central do carro, só no simulador DHU.

## [0.9.2] - 2026-10-27

### Corrigido
- **Perfil do Uno com protocolo fixo (`ATSP5`)** em vez de `ATSPA5`. Com o `A`, uma falha de inicialização da linha K (por exemplo, ao conectar com a ignição desligada) fazia o ELM327 procurar sozinho os protocolos CAN, transmitindo a 500 kbps na rede da carroceria (pinos 6/14, de 50 kbps). Agora ele só fala na linha K, e a escuta pelo ESP32 nos pinos 6/14 pode conviver com ele pelo cabo Y.

## [0.9.1] - 2026-10-27

### Corrigido
- **% de etanol confundido com o da lei:** o campo passou a se chamar **Etanol da bomba no tanque**, com a explicação de que a gasolina já vem com etanol (32% na comum e aditivada desde 1º/08/2026; 25% na premium) e que isso não deve ser somado ali. Quem escolhia 32% ou 35% pensando na lei fazia o app calcular cerca de 10% a mais de consumo. As opções da lista agora dizem "só gasolina" e "só etanol", e o perfil do Uno descreve a gasolina como "Gasolina C (E27–E32)".

### Adicionado
- A gravação de diagnóstico registra o % de etanol, o fator de calibração e o nível do tanque no início de cada viagem e a cada mudança durante a captura. O `tools/trip-report` passa a usar o % gravado em cada viagem quando `--ethanol-pct` não é informado.

## [0.9.0] - 2026-10-26

### Adicionado
- **Escuta passiva da rede CAN** com Arduino Uno + MCP2515, para mapear o que os módulos da carroceria transmitem (tanque, hodômetro, setas, portas):
  - firmware em `firmware/arduino-can-listen`: modo **Listen-Only** do MCP2515, em que o chip não transmite nada à rede; para se o modo não for confirmado; 50 kbit/s com busca das outras velocidades;
  - ferramenta `tools/can-capture`: grava pela USB com marcas de evento (Enter) e mostra o resumo por ID, o antes/depois e o que muda em volta de cada marca;
  - guia de ligação e roteiro em `docs/can-escuta.md`.
- **Layout para tablet e celular deitado** (a partir de 840 px de largura): Detalhes, Abastecimentos e Histórico em duas colunas; Ajustes com os cartões em duas colunas; formulário de abastecimento sempre à vista em telas altas. No celular em pé nada muda.
- `CONTRIBUTING.md` e modelos de issue: problema, perfil de veículo novo e sugestão.
- **Identidade Eletro Info Tecnologia:**
  - ícone novo do app com o emblema `[EI]` da Eletro Info em branco sobre o vermelho da marca, no formato adaptativo (redondo, quadrado ou o da Xiaomi, conforme o celular) e com versão monocromática para os ícones temáticos do Android 13+; vale também para o Android Auto;
  - ícone da notificação com o mesmo emblema, e as notificações com o vermelho da marca.
- **Ajustes → Sobre:** versão e build instalados, quem desenvolve, links para o site, o código-fonte e os relatos de problema, privacidade, licença e componentes de código aberto.
- **Atualizar modelos** no Assistente IA: com a chave colada, o app busca na conta do provedor os modelos de texto disponíveis (OpenAI, Claude, Gemini ou endereço próprio) e mostra uma lista para escolher. Modelos de imagem, voz, vídeo e embeddings ficam de fora. A chave é a única coisa enviada.

### Alterado
- **Consultas ao banco sem travar a tela:** histórico, abastecimentos, exportações, importação do CSV, respostas guardadas e pré-visualizações da IA agora respondem de forma assíncrona. Antes, a tela ficava parada até o banco responder, o que pesava com muitas viagens ou ao analisar uma viagem longa. Também evita salvar o mesmo abastecimento duas vezes com toques repetidos.
- **Ferramentas de build atualizadas:**
  - Android Gradle Plugin 9.4.1, com o Kotlin embutido no AGP;
  - Gradle 9.8.2, Kotlin 2.4.21 e KSP 2.3.12;
  - compila com o **SDK 37**; o `targetSdk` continua 36, então o comportamento do app no celular não muda.
- **Build em Kotlin DSL** (`*.gradle.kts`), com as versões centralizadas em `gradle/libs.versions.toml`. Some a sintaxe Groovy que deixaria de funcionar no Gradle 10.
- **Bibliotecas:** core 1.19.1, activity 1.13, fragment 1.9.1, lifecycle 2.11, webkit 1.18, Room 2.8.5, play-services-location 21.4, coroutines 1.11, kotlinx-serialization 1.12, Robolectric 4.17 e androidx.test 1.7/1.3. Cobre os PRs #1–#4 do Dependabot.
- Gravação das preferências no formato `edit { }` do androidx (avisos `UseKtx` do lint novo).

### Corrigido
- **Assistente IA travado em "Testando…"/"Consultando a IA…":** a resposta do provedor nunca chegava à tela, por um erro no nome da função JavaScript que recebe o resultado (introduzido na v0.8.0, na divisão da ponte). Valia para o teste de conexão, Explicar com IA, Analisar viagem e Perguntar à IA. Um teste novo confere que toda resposta enviada à tela chama uma função que existe.
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

[Não lançado]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.9.2...HEAD
[0.9.2]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/AlanMartines/Universal-OBD-Dashboard/compare/v0.8.1...v0.9.0
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
