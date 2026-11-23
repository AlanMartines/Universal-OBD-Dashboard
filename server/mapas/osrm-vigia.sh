#!/bin/sh
# Vigia do contêiner osrm: sobe o osrm-routed com o mapa de encaixe ativo e troca sem reiniciar o
# contêiner. O contêiner "mapas" grava cada versão numa pasta (/data/v<número>) e o nome da ativa em
# /data/ativo; sem mapa, o OSRM fica parado e o painel mostra o traço do GPS.
# Também aceita o formato antigo do scripts/preparar-rotas.sh (/data/regiao.osrm.*).
set -u
DATA=/data
PID=""
ATUAL=""

alvo() {
  if [ -f "$DATA/ativo" ]; then
    v=$(cat "$DATA/ativo")
    case "$v" in v[0-9]*) [ -f "$DATA/$v/regiao.osrm.mldgr" ] && { echo "$DATA/$v/regiao.osrm"; return; } ;; esac
  fi
  [ -f "$DATA/regiao.osrm.mldgr" ] && echo "$DATA/regiao.osrm"
}

parar() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
  fi
  PID=""
}

trap 'parar; exit 0' TERM INT

while :; do
  NOVO=$(alvo)
  if [ "$NOVO" != "$ATUAL" ] || { [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; }; then
    parar
    ATUAL="$NOVO"
    if [ -n "$ATUAL" ]; then
      echo "osrm: carregando $ATUAL"
      osrm-routed --algorithm mld --max-matching-size 500 "$ATUAL" &
      PID=$!
    else
      echo "osrm: sem mapa de encaixe; aguardando"
    fi
  fi
  sleep 10 &
  wait $!
done
