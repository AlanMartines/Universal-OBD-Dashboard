#!/bin/sh
# Baixa o mapa do Brasil para rodar no próprio servidor, sem depender de serviço externo de mapas.
# Dados: OpenStreetMap, por meio dos arquivos públicos do Protomaps. Precisa de Docker e de alguns GB livres.
# Uso: sh scripts/baixar-mapa.sh [pasta de destino]
set -eu
DEST="${1:-$(dirname "$0")/../data/maps}"
BBOX="${MAP_BBOX:--74.2,-34.0,-28.6,5.5}"
MAXZOOM="${MAP_MAXZOOM:-15}"
IMAGE="protomaps/go-pmtiles:v1.31.2"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

BUILD="$(curl -fsS https://build-metadata.protomaps.dev/builds.json | sed 's/.*"key":"\([0-9]*\.pmtiles\)".*/\1/')"
[ -n "$BUILD" ] || { echo "Não foi possível descobrir a versão mais recente do mapa." >&2; exit 1; }
echo "Recortando $BUILD (área $BBOX, zoom até $MAXZOOM). Pode levar bastante tempo."
docker run --rm -v "$DEST:/data" "$IMAGE" extract "https://build.protomaps.com/$BUILD" /data/brasil.tmp.pmtiles --bbox="$BBOX" --maxzoom="$MAXZOOM"
mv "$DEST/brasil.tmp.pmtiles" "$DEST/brasil.pmtiles"

echo "Baixando fontes e ícones do mapa."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz | tar xz -C "$TMP"
mkdir -p "$DEST/assets"
rm -rf "$DEST/assets/fonts" "$DEST/assets/sprites"
cp -R "$TMP"/basemaps-assets-main/fonts "$TMP"/basemaps-assets-main/sprites "$DEST/assets/"

ls -lh "$DEST/brasil.pmtiles"
echo "Pronto. Rode: docker compose up -d web"
