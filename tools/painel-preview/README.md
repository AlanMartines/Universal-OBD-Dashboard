# Pré-visualização do painel

Página de avaliação dos temas do painel (`app/src/main/assets/web/dash.js`, `dash.css`) fora do app, com o percurso simulado de `sim.js` (usa o perfil de exemplo Fiat Uno Vivace; no app, cada veículo usa o seu próprio perfil): seletores de tema (Minimal, Cápsula, HUD), luz (Auto/Dia/Noite), orientação da tela e cenário (percurso, esportivo, superaquecimento, luz de injeção).

```bash
python3 tools/painel-preview/build.py               # página para publicar como Artifact
python3 tools/painel-preview/build.py --standalone  # HTML completo para abrir no navegador
```

A saída vai para `tools/painel-preview/out/` (ignorada pelo git). Os arquivos de origem são `harness.html` (moldura e controles) e os assets do app; nada aqui entra no APK.

Para avaliar com uma viagem real, gere um trecho com a ferramenta de recálculo e passe-o ao build:

```bash
python3 tools/trip-report/trip_report.py /caminho/das/gravacoes --replay /tmp/replay.json --replay-minutes 20
python3 tools/painel-preview/build.py --replay /tmp/replay.json
```

A página ganha a fonte "Viagem real", com reprodução (1×, 4×, 16×) e barra de tempo. O trecho não leva coordenadas GPS nem o VIN; mesmo assim, não versione arquivos de replay.

