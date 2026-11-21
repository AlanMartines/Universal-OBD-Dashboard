#!/usr/bin/env bash
# Aplica scripts/proteger-auditoria.sql no banco da produção, como dono (DB_OWNER). Rodar uma vez, depois
# que a API nova subiu (migração 012). Pode rodar de novo sem problema.
#   sudo server/scripts/proteger-auditoria.sh              (produção)
#   PROJETO=obd-homolog ENV_FILE=/etc/obd-homolog/homolog.env ... (outro projeto do Compose)
set -euo pipefail
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARGS=(--project-directory "$SERVER_DIR")
[ -n "${PROJETO:-}" ] && ARGS+=(-p "$PROJETO")
[ -n "${ENV_FILE:-}" ] && ARGS+=(--env-file "$ENV_FILE")
OWNER="${DB_OWNER:-obd_owner}"
DB="${DB_NAME:-obd}"
docker compose "${ARGS[@]}" exec -T db psql -U "$OWNER" -d "$DB" -v ON_ERROR_STOP=1 -q < "$SERVER_DIR/scripts/proteger-auditoria.sql"
docker compose "${ARGS[@]}" exec -T db psql -U "$OWNER" -d "$DB" -Atc \
  "SELECT 'dona: ' || tableowner FROM pg_tables WHERE tablename = 'audit_log'
   UNION ALL SELECT 'aplicação: ' || string_agg(privilege_type, ', ' ORDER BY privilege_type) FROM information_schema.role_table_grants
     WHERE table_name = 'audit_log' AND grantee = (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public')
   UNION ALL SELECT 'trava: ' || evtname FROM pg_event_trigger WHERE evtname = 'protege_auditoria'"
