#!/usr/bin/env bash
# Teste de restauração do backup do banco (roda todo mês pelo cron).
#
# Sobe um Postgres 17 descartável, sem rede e sem porta, restaura nele o
# backup diário mais recente e confere:
#   - a restauração termina sem erro (--exit-on-error);
#   - todas as tabelas do banco em produção existem na cópia;
#   - as migrações aplicadas são as mesmas;
#   - há ao menos um usuário.
# No fim, o contêiner é apagado. A produção só é lida (lista de tabelas).
#
# Uso: sudo server/scripts/testar-restauracao.sh [arquivo.dump.gpg]
set -euo pipefail
umask 077

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/usr/local/obdBackup}"
SENHA="${SENHA:-/etc/obd-backup/senha}"
DB_NAME="${DB_NAME:-obd}"
DB_OWNER="${DB_OWNER:-obd_owner}"
NOME="obd-teste-restauracao"

log() { echo "$(date '+%F %T') - $*"; }
falha() { log "[ERRO] $*"; exit 1; }

DUMP="${1:-$(ls -1 "$BACKUP_DIR"/diario/obd-*.dump.gpg 2>/dev/null | sort | tail -1)}"
[ -n "$DUMP" ] && [ -r "$DUMP" ] || falha "nenhum backup encontrado em $BACKUP_DIR/diario"
log "testando $DUMP"

decifrar() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$SENHA" -d "$1"
}
sql() { docker exec -i "$NOME" psql -U "$DB_OWNER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
prod() {
  docker compose --project-directory "$SERVER_DIR" exec -T db \
    psql -U "$DB_OWNER" -d "$DB_NAME" -Atc "$1"
}

docker rm -f "$NOME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$NOME" --network none \
  -e POSTGRES_USER="$DB_OWNER" -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" postgres:17-alpine >/dev/null

for _ in $(seq 60); do
  docker exec "$NOME" pg_isready -U "$DB_OWNER" -d "$DB_NAME" -q 2>/dev/null && break
  sleep 1
done
sleep 2  # o entrypoint reinicia o servidor uma vez depois do initdb
docker exec "$NOME" pg_isready -U "$DB_OWNER" -d "$DB_NAME" -q || falha "o Postgres de teste não subiu"

# Os papéis da aplicação precisam existir para os GRANTs; sem senha nem login.
for papel in $(prod "select rolname from pg_roles where rolname !~ '^pg_' and rolname <> current_user"); do
  sql "create role \"$papel\" nologin" >/dev/null
done

decifrar "$DUMP" | docker exec -i "$NOME" pg_restore -U "$DB_OWNER" -d "$DB_NAME" --exit-on-error \
  || falha "a restauração parou com erro"

TABELAS_PROD="$(prod "select tablename from pg_tables where schemaname='public' order by 1")"
TABELAS_COPIA="$(sql "select tablename from pg_tables where schemaname='public' order by 1")"
FALTANDO="$(comm -23 <(echo "$TABELAS_PROD") <(echo "$TABELAS_COPIA"))"
[ -z "$FALTANDO" ] || falha "tabelas que faltam na cópia: $(echo $FALTANDO)"

MIG_PROD="$(prod 'select count(*) from schema_migrations')"
MIG_COPIA="$(sql 'select count(*) from schema_migrations')"
[ "$MIG_PROD" = "$MIG_COPIA" ] || falha "migrações: produção $MIG_PROD, cópia $MIG_COPIA"
[ "$(sql 'select count(*) from users')" -gt 0 ] || falha "a cópia não tem usuários"

log "restauração ok: $(echo "$TABELAS_COPIA" | wc -l) tabelas, $MIG_COPIA migrações"
for t in telemetry_samples fuel_ups health_daily users; do
  log "  $t: $(sql "select count(*) from $t") linhas"
done
