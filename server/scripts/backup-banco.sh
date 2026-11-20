#!/usr/bin/env bash
# Backup do banco do painel (PostgreSQL do Compose "obd-telemetry").
#
# O que faz, nesta ordem:
#   1. pg_dump (formato custom) e pg_dumpall --globals-only (papéis), pelo
#      contêiner "db"; nada é exposto em porta.
#   2. Cifra tudo com GPG simétrico AES-256, com a frase do arquivo SENHA.
#      Também guarda uma cópia cifrada do server/.env.
#   3. Confere o dump: decifra e lista o conteúdo com pg_restore --list.
#   4. Retenção local: 7 diários, 4 semanais (domingo) e 6 mensais (dia 1).
#   5. Espelha a pasta no armazenamento externo com rclone (REMOTO).
#
# A frase fica FORA do /root (se o /root também vai para a nuvem, a chave
# subiria junto com o cadeado). Sem a frase, o backup não se abre:
# guarde uma cópia num gerenciador de senhas.
#
# Uso: sudo server/scripts/backup-banco.sh  (o cron chama todo dia)
# Configuração em /etc/obd-backup/backup.conf (fora do Git), por exemplo:
#   REMOTO=meu-remoto:bucket/pasta   (destino do rclone; obrigatório)
# Variáveis opcionais: BACKUP_DIR, SENHA, REMOTO, SEM_ENVIO=1 (não envia).
set -euo pipefail
umask 077

CONF="${CONF:-/etc/obd-backup/backup.conf}"
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/usr/local/obdBackup}"
SENHA="${SENHA:-/etc/obd-backup/senha}"
REMOTO="${REMOTO:-}"
DB_NAME="${DB_NAME:-obd}"
DB_OWNER="${DB_OWNER:-obd_owner}"
MANTER_DIARIOS=7
MANTER_SEMANAIS=4
MANTER_MENSAIS=6

log() { echo "$(date '+%F %T') - $*"; }
falha() { log "[ERRO] $*"; exit 1; }

exec 9>/tmp/obd-backup.lock
flock -n 9 || falha "outro backup já está rodando"

[ -n "$REMOTO" ] || [ "${SEM_ENVIO:-0}" = 1 ] || falha "defina REMOTO em $CONF"
[ -r "$SENHA" ] || falha "frase não encontrada em $SENHA"
[ "$(stat -c %a "$SENHA")" = 600 ] || falha "$SENHA precisa de chmod 600"

compose() { docker compose --project-directory "$SERVER_DIR" "$@"; }
cifrar() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$SENHA" \
      --symmetric --cipher-algo AES256 --compress-algo none -o "$1"
}
decifrar() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$SENHA" -d "$1"
}

mkdir -p "$BACKUP_DIR"/{diario,semanal,mensal}
DIA="$(date +%F)"
BASE="obd-$DIA"
TMP="$(mktemp -d "$BACKUP_DIR/.tmp.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

log "início do backup $BASE"

# 1 e 2. Dump direto para o arquivo cifrado (o dump em claro não toca o disco).
compose exec -T db pg_dump -U "$DB_OWNER" -d "$DB_NAME" -Fc | cifrar "$TMP/$BASE.dump.gpg"
compose exec -T db pg_dumpall -U "$DB_OWNER" --globals-only | cifrar "$TMP/$BASE.papeis.sql.gpg"
cifrar "$TMP/$BASE.env.gpg" < "$SERVER_DIR/.env"

# 3. Conferência: o arquivo decifra por inteiro (o GPG valida a integridade)
#    e o pg_restore reconhece as tabelas. O --list lê só o índice e fecha o
#    cano cedo, por isso o erro do gpg nessa segunda leitura é descartado.
for f in "$TMP"/*.gpg; do decifrar "$f" > /dev/null || falha "não decifrou: $f"; done
TABELAS="$( (decifrar "$TMP/$BASE.dump.gpg" 2>/dev/null || true) |
  compose exec -T db pg_restore --list | grep -c ' TABLE DATA ' || true)"
[ "${TABELAS:-0}" -gt 0 ] || falha "o dump não tem dados de tabela; nada foi trocado"
log "dump conferido: $TABELAS tabelas com dados, $(du -h "$TMP/$BASE.dump.gpg" | cut -f1)"

# 4. Retenção.
mv -f "$TMP"/"$BASE".* "$BACKUP_DIR/diario/"
if [ "$(date +%u)" = 7 ]; then cp -f "$BACKUP_DIR/diario/$BASE".* "$BACKUP_DIR/semanal/"; fi
if [ "$(date +%d)" = 01 ]; then cp -f "$BACKUP_DIR/diario/$BASE".* "$BACKUP_DIR/mensal/"; fi

podar() {  # podar <pasta> <quantos dias manter>
  ls -1 "$1" | sed -n 's/^obd-\([0-9-]\{10\}\)\..*/\1/p' | sort -u -r | tail -n +"$(($2 + 1))" |
    while read -r d; do rm -f "$1/obd-$d".*; log "removido $(basename "$1")/obd-$d"; done
}
podar "$BACKUP_DIR/diario" "$MANTER_DIARIOS"
podar "$BACKUP_DIR/semanal" "$MANTER_SEMANAIS"
podar "$BACKUP_DIR/mensal" "$MANTER_MENSAIS"

date '+%F %T' > "$BACKUP_DIR/ULTIMO_OK"

# 5. Envio. O --max-delete evita que uma pasta local vazia apague o remoto.
if [ "${SEM_ENVIO:-0}" = 1 ]; then
  log "envio pulado (SEM_ENVIO=1)"
else
  rclone sync --checksum --fast-list --retries 5 --max-delete 20 \
    --exclude '.tmp.*/**' "$BACKUP_DIR" "$REMOTO"
  log "enviado para $REMOTO"
fi

log "fim do backup $BASE"
