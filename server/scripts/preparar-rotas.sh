#!/bin/sh
# Prepara o OSRM, que encaixa o percurso nas ruas do mapa, rodando no próprio servidor.
# Dados: OpenStreetMap (recorte do Brasil da Geofabrik, ~1,8 GB). Processamento: 30–60 min,
# ~10 GB de disco e alguns GB de memória. Rode de novo de tempos em tempos para atualizar as ruas.
# Uso: sh scripts/preparar-rotas.sh [pasta de destino]
set -eu
DEST="${1:-$(dirname "$0")/../data/osrm}"
PBF_URL="${OSRM_PBF_URL:-https://download.geofabrik.de/south-america/brazil-latest.osm.pbf}"
IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

echo "Baixando as ruas do OpenStreetMap ($PBF_URL)."
curl -fL --retry 3 -o "$DEST/regiao.tmp.osm.pbf" "$PBF_URL"
mv "$DEST/regiao.tmp.osm.pbf" "$DEST/regiao.osm.pbf"

# Processa numa pasta à parte e só troca no fim: o OSRM no ar segue com os dados antigos até lá.
WORK="$DEST/novo"
rm -rf "$WORK"
mkdir -p "$WORK"
ln "$DEST/regiao.osm.pbf" "$WORK/regiao.osm.pbf" 2>/dev/null || cp "$DEST/regiao.osm.pbf" "$WORK/regiao.osm.pbf"
echo "Processando (perfil carro). Pode levar bastante tempo."
docker run --rm -v "$WORK:/data" "$IMAGE" osrm-extract -p /opt/car.lua /data/regiao.osm.pbf
docker run --rm -v "$WORK:/data" "$IMAGE" osrm-partition /data/regiao.osrm
docker run --rm -v "$WORK:/data" "$IMAGE" osrm-customize /data/regiao.osrm
rm -f "$WORK/regiao.osm.pbf"
rm -f "$DEST"/regiao.osrm*
mv "$WORK"/regiao.osrm* "$DEST/"
rmdir "$WORK"
# O arquivo baixado só serve para o processamento: a próxima atualização baixa de novo.
rm -f "$DEST/regiao.osm.pbf"

du -sh "$DEST"
echo "Pronto. No .env: COMPOSE_PROFILES=rotas e OSRM_URL=http://osrm:5000; depois: docker compose up -d"
