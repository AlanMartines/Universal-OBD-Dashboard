#!/usr/bin/env bash
# Homologação: um segundo painel no mesmo servidor, para testar uma versão (migrações, atualizações de
# dependências, mudanças grandes) antes da produção.
#
# - Projeto do Compose "obd-homolog": contêineres, redes, imagens e banco próprios. Nada é compartilhado
#   com a produção; o mapa (pmtiles) é montado só para leitura.
# - Roda de uma cópia separada do repositório (git worktree em <repo>-homolog), então trocar a versão da
#   homologação nunca mexe na pasta da produção (de onde o cron chama o backup).
# - Só em 127.0.0.1:28480, sem Nginx: acesse por túnel SSH
#     ssh -L 28480:127.0.0.1:28480 <servidor>     e abra http://localhost:28480
# - Sem SMTP: nenhum e-mail sai daqui (alertas e redefinições ficam na fila e somem em um dia).
# - Configuração em /etc/obd-homolog/homolog.env (fora do Git e do /root), criada pelo "preparar".
#
# Uso: sudo server/scripts/homologacao.sh <comando>
#   preparar           cria a configuração, com segredos próprios (a chave do 2FA é a da produção,
#                      para os logins com 2FA funcionarem depois do copiar-producao)
#   subir [ref]        põe a cópia na ref pedida (padrão: master; ex.: origin/feat/x depois de um
#                      git fetch) e sobe a homologação, aplicando as migrações dessa versão
#   copiar-producao    troca o banco da homologação pelo backup cifrado mais recente da produção
#                      (sessões, desafios de 2FA, links e e-mails pendentes são apagados)
#   estado             contêineres e versão em teste
#   parar              para os contêineres; o banco da homologação fica
set -euo pipefail
umask 077

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WT="${HOMOLOG_DIR:-$REPO-homolog}"
ENVF="${HOMOLOG_ENV:-/etc/obd-homolog/homolog.env}"
PROJ=obd-homolog
BACKUP_DIR="${BACKUP_DIR:-/usr/local/obdBackup}"
SENHA="${SENHA:-/etc/obd-backup/senha}"

log() { echo "$(date '+%F %T') - $*"; }
falha() { log "[ERRO] $*"; exit 1; }
compose() { docker compose -p "$PROJ" --project-directory "$WT/server" -f "$WT/server/docker-compose.yml" --env-file "$ENVF" "$@"; }
valor() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
aleatorio() { openssl rand -hex 32; }

preparar() {
  [ -e "$ENVF" ] && falha "$ENVF já existe; apague-o à mão para recriar"
  local prod="$REPO/server/.env"
  [ -r "$prod" ] || falha "não achei o .env da produção em $prod"
  local totp; totp="$(sed -n 's/^TOTP_ENCRYPTION_KEY=//p' "$prod" | tail -1)"
  [ -n "$totp" ] || falha "TOTP_ENCRYPTION_KEY não está no .env da produção"
  install -d -m 700 "$(dirname "$ENVF")"
  cat > "$ENVF" <<EOF
# Homologação do painel (gerado por homologacao.sh em $(date +%F)). Não use estes valores na produção.
APP_URL=http://localhost:28480
ALLOW_INSECURE_COOKIE=true
HTTP_BIND=127.0.0.1
HTTP_PORT=28480
ROUTING_SUBNET=10.88.1.0/24
MAP_DATA_DIR=$REPO/server/data/maps
COMPOSE_PROFILES=
OSRM_URL=
POSTGRES_PASSWORD=$(aleatorio)
APP_DB_PASSWORD=$(aleatorio)
INTERNAL_API_KEY=$(aleatorio)
FORM_SECRET=$(aleatorio)
TOTP_ENCRYPTION_KEY=$totp
ADMIN_USERNAME=homolog
ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
SIGNUP_DEFAULT=false
LOG_LEVEL=info
EOF
  chmod 600 "$ENVF"
  log "configuração criada em $ENVF (o admin inicial do banco vazio é \"homolog\"; a senha está no arquivo)"
}

subir() {
  local ref="${1:-master}"
  [ -r "$ENVF" ] || falha "rode primeiro: $0 preparar"
  git -C "$REPO" rev-parse --verify -q "$ref^{commit}" >/dev/null || falha "ref desconhecida: $ref (faça git fetch antes?)"
  # A cópia precisa da permissão normal (o umask 077 deste script é para a configuração com segredos):
  # o Postgres lê o db/init e as imagens levam os arquivos com o dono do contêiner.
  if [ -d "$WT/.git" ] || [ -f "$WT/.git" ]; then
    # a cópia é só da homologação: sobras locais são descartadas antes de trocar de versão
    (umask 022; git -C "$WT" clean -fdq && git -C "$WT" checkout -q -f --detach "$ref")
  else
    (umask 022; git -C "$REPO" worktree add -q --detach "$WT" "$ref")
  fi
  log "homologação na versão $(git -C "$WT" log --oneline -1)"
  compose up -d --build
  log "no ar em http://localhost:28480 (pelo túnel SSH)"
}

copiar_producao() {
  [ -r "$ENVF" ] || falha "rode primeiro: $0 preparar"
  [ -d "$WT" ] || falha "rode primeiro: $0 subir"
  local dump; dump="$(ls -1 "$BACKUP_DIR"/diario/obd-*.dump.gpg 2>/dev/null | sort | tail -1)"
  [ -n "$dump" ] || falha "nenhum backup em $BACKUP_DIR/diario"
  local db owner; db="$(valor DB_NAME)"; db="${db:-obd}"; owner="$(valor DB_OWNER)"; owner="${owner:-obd_owner}"
  log "copiando $dump para o banco da homologação"
  compose stop api web worker mailer
  compose up -d db
  for _ in $(seq 60); do compose exec -T db pg_isready -q -U "$owner" -d "$db" && break; sleep 1; done
  compose exec -T db dropdb -U "$owner" --if-exists "$db"
  compose exec -T db createdb -U "$owner" "$db"
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$SENHA" -d "$dump" \
    | compose exec -T db pg_restore -U "$owner" -d "$db" --exit-on-error
  # Nada que valha fora da produção: sessões, desafios, links de e-mail e e-mails na fila.
  compose exec -T db psql -U "$owner" -d "$db" -v ON_ERROR_STOP=1 -qc \
    'DELETE FROM sessions; DELETE FROM mfa_challenges; DELETE FROM password_resets; DELETE FROM email_changes; DELETE FROM mail_outbox;'
  compose up -d
  log "pronto: entre com o usuário e a senha da produção (o 2FA também é o mesmo)"
}

case "${1:-}" in
  preparar) preparar ;;
  subir) subir "${2:-}" ;;
  copiar-producao) copiar_producao ;;
  estado) compose ps; [ -d "$WT" ] && git -C "$WT" log --oneline -1 ;;
  parar) compose stop ;;
  *) sed -n '2,25p' "$0"; exit 1 ;;
esac
