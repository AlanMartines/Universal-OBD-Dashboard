#!/usr/bin/env bash
# Vigia o servidor do painel e avisa os Super Admins por e-mail (pela mesma fila do painel: mail_outbox).
# Roda pelo cron a cada 10 min. Confere:
#   - disco: uso acima de DISCO_LIMITE % em /, no diretório do Docker e na pasta dos backups;
#   - memória: disponível abaixo de MEMORIA_MIN %;
#   - contêineres do painel (projeto obd-telemetry): parado, reiniciando ou com saúde ruim;
#   - backup: nenhum backup bem-sucedido há mais de BACKUP_MAX_HORAS (arquivo ULTIMO_OK).
# Um problema avisa ao aparecer e repete no máximo a cada REPETIR_HORAS enquanto durar; ao normalizar,
# sai um aviso de "normalizado". O estado fica em /var/lib/obd-monitor.
#
# Uso: sudo server/scripts/monitor-servidor.sh        (SEM_ENVIO=1 só mostra, sem pôr e-mail na fila)
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJETO="${PROJETO:-obd-telemetry}"
DISCO_LIMITE="${DISCO_LIMITE:-85}"
MEMORIA_MIN="${MEMORIA_MIN:-10}"
BACKUP_DIR="${BACKUP_DIR:-/usr/local/obdBackup}"
BACKUP_MAX_HORAS="${BACKUP_MAX_HORAS:-26}"
REPETIR_HORAS="${REPETIR_HORAS:-6}"
ESTADO="${ESTADO_DIR:-/var/lib/obd-monitor}"
DB_OWNER="${DB_OWNER:-obd_owner}"
DB_NAME="${DB_NAME:-obd}"
HOST="$(hostname)"

log() { echo "$(date '+%F %T') - $*"; }
mkdir -p "$ESTADO"
exec 9>"$ESTADO/.lock"
flock -n 9 || exit 0

declare -A PROBLEMAS=()   # chave -> texto

# ---------- disco
for alvo in / "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)" "$BACKUP_DIR"; do
  [ -e "$alvo" ] || continue
  read -r fs uso livre <<<"$(df -P "$alvo" | awk 'NR==2 {gsub("%","",$5); print $1, $5, $4}')"
  if [ "$uso" -ge "$DISCO_LIMITE" ]; then
    PROBLEMAS["disco_${fs//\//_}"]="Disco $fs (onde fica $alvo) com ${uso}% de uso; livres: $((livre / 1048576)) GB (limite: ${DISCO_LIMITE}%)."
  fi
done

# ---------- memória
read -r total disp <<<"$(awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {print t, a}' /proc/meminfo)"
pct=$((disp * 100 / total))
if [ "$pct" -lt "$MEMORIA_MIN" ]; then
  PROBLEMAS[memoria]="Memória disponível em ${pct}% ($((disp / 1048576)) de $((total / 1048576)) GB; mínimo: ${MEMORIA_MIN}%)."
fi

# ---------- contêineres do painel
while IFS='|' read -r nome status; do
  [ -n "$nome" ] || continue
  case "$status" in
    Up*unhealthy*|Restarting*|Exited*|Dead*|Created*) PROBLEMAS["conteiner_$nome"]="Contêiner $nome: $status." ;;
  esac
done < <(docker ps -a --filter "label=com.docker.compose.project=$PROJETO" --format '{{.Names}}|{{.Status}}')

# ---------- backup
if [ -r "$BACKUP_DIR/ULTIMO_OK" ]; then
  ultimo="$(date -d "$(cat "$BACKUP_DIR/ULTIMO_OK")" +%s 2>/dev/null || echo 0)"
  idade=$(( ($(date +%s) - ultimo) / 3600 ))
  if [ "$idade" -ge "$BACKUP_MAX_HORAS" ]; then
    PROBLEMAS[backup]="Último backup do banco bem-sucedido há ${idade} h ($(cat "$BACKUP_DIR/ULTIMO_OK")). Veja /var/log/obd-backup.log."
  fi
else
  PROBLEMAS[backup]="Nenhum backup do banco registrado em $BACKUP_DIR (falta o ULTIMO_OK)."
fi

# ---------- o que avisar
agora=$(date +%s)
novos=(); normalizados=(); marcar=(); limpar=()
for chave in "${!PROBLEMAS[@]}"; do
  f="$ESTADO/$chave"
  if [ ! -f "$f" ] || [ $((agora - $(cat "$f"))) -ge $((REPETIR_HORAS * 3600)) ]; then
    novos+=("- ${PROBLEMAS[$chave]}")
    marcar+=("$f")
  fi
done
for f in "$ESTADO"/*; do
  [ -f "$f" ] || continue
  chave="$(basename "$f")"
  if [ -z "${PROBLEMAS[$chave]+x}" ]; then
    normalizados+=("- $chave")
    limpar+=("$f")
  fi
done
[ ${#novos[@]} -eq 0 ] && [ ${#normalizados[@]} -eq 0 ] && exit 0

assunto="Servidor $HOST: "
corpo="Verificação do servidor do painel em $(date '+%d/%m/%Y %H:%M').\n"
if [ ${#novos[@]} -gt 0 ]; then
  assunto+="${#novos[@]} problema(s)"
  corpo+="\nPrecisa de atenção:\n$(printf '%s\n' "${novos[@]}")\n"
fi
if [ ${#normalizados[@]} -gt 0 ]; then
  [ ${#novos[@]} -gt 0 ] && assunto+=", "
  assunto+="${#normalizados[@]} normalizado(s)"
  corpo+="\nVoltou ao normal:\n$(printf '%s\n' "${normalizados[@]}")\n"
fi
corpo+="\nAviso automático do scripts/monitor-servidor.sh. Enquanto o problema durar, ele repete a cada ${REPETIR_HORAS} h."
corpo="$(printf '%b' "$corpo")"

log "$assunto"
printf '%s\n' "$corpo" | sed 's/^/    /'
[ "${SEM_ENVIO:-0}" = 1 ] && { log "SEM_ENVIO=1: nada foi para a fila"; exit 0; }

# Para os Super Admins com e-mail, pela fila do painel (o serviço mailer envia). Variáveis do psql: sem SQL montado à mão.
n="$(docker compose --project-directory "$SERVER_DIR" -p "$PROJETO" exec -T db \
  psql -U "$DB_OWNER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atq -v assunto="$assunto" -v corpo="$corpo" <<'SQL'
WITH novos AS (
  INSERT INTO mail_outbox (recipient, subject, body)
  SELECT email, :'assunto', :'corpo' FROM users WHERE role = 'superadmin' AND email IS NOT NULL AND NOT disabled
  RETURNING 1)
SELECT count(*) FROM novos;
SQL
)" || { log "[ERRO] não consegui pôr o aviso na fila do painel (banco fora do ar?)"; exit 1; }
log "aviso na fila para $n Super Admin(s)"
# o estado só muda depois que a fila aceitou: banco fora do ar não faz o aviso se perder
for f in "${marcar[@]}"; do echo "$agora" > "$f"; done
for f in "${limpar[@]}"; do rm -f "$f"; done
