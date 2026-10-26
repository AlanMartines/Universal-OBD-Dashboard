# Recálculo de viagens

Relê as gravações de diagnóstico do app (`diag_*.jsonl` / `.jsonl.gz`, exportadas em *Ajustes → Gravação de diagnóstico*) com as fórmulas do perfil JSON **atual**. Assim, gravações feitas com fórmulas antigas são corrigidas na análise. Só usa a biblioteca padrão do Python 3.

```bash
# Relatório por viagem (sessões agrupadas com a mesma regra de retomada do app)
python3 tools/trip-report/trip_report.py /caminho/das/gravacoes [--profile perfil.json] [--ethanol-pct 0]

# Calibração com o CSV exportado na aba Abastecimentos (um resultado por intervalo entre tanques cheios)
python3 tools/trip-report/trip_report.py /caminho --fuel-csv abastecimentos.csv

# Calibração do consumo: litros reais de um abastecimento → volumetric_efficiency sugerida
python3 tools/trip-report/trip_report.py /caminho --since 2026-10-23T13:00 --until 2026-10-24T09:30 --actual-liters 62.0

# Trecho para o protótipo do painel (tools/painel-preview), sem coordenadas GPS nem VIN
python3 tools/trip-report/trip_report.py /caminho --replay /tmp/replay.json --replay-minutes 20
```

O relatório traz distância (OBD e GPS), tempo em movimento e parado, consumo estimado, litros gastos em marcha lenta, corte de injeção, tempo em cada marcha, temperaturas, tensões e alertas reavaliados.

As gravações contêm o VIN do veículo e o trajeto GPS: não as versione. Testes: `python3 -m unittest discover -s tools/trip-report`.
