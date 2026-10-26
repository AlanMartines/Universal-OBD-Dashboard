#!/usr/bin/env bash
# Cria a chave de assinatura de RELEASE e mostra os valores dos 4 secrets do GitHub Actions.
#
# Rode UMA vez, no seu computador. A chave fica FORA do repositório e precisa de backup:
# sem ela (ou sem a senha) não é possível publicar atualizações do app já instalado.
#
# Uso: scripts/criar-chave-release.sh [arquivo.jks]
set -euo pipefail

KEYSTORE="${1:-$HOME/.android-keys/universal-obd-release.jks}"
ALIAS="universal-obd"

command -v keytool >/dev/null || { echo "keytool não encontrado: instale o JDK 17 ou defina o PATH" >&2; exit 1; }
if [ -e "$KEYSTORE" ]; then
  echo "Já existe $KEYSTORE — não vou sobrescrever uma chave de release." >&2
  exit 1
fi
mkdir -p "$(dirname "$KEYSTORE")"
chmod 700 "$(dirname "$KEYSTORE")"

echo "Criando $KEYSTORE (alias '$ALIAS', RSA 4096, validade 30 anos)."
echo "O keytool vai pedir uma senha (mín. 6 caracteres) e seus dados (nome, cidade...)."
echo
keytool -genkeypair -v -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10950
chmod 600 "$KEYSTORE"

B64="$KEYSTORE.base64.txt"
base64 -w0 "$KEYSTORE" > "$B64"
chmod 600 "$B64"

cat <<EOF

Pronto. Agora cadastre 4 secrets em:
  GitHub → repositório → Settings → Secrets and variables → Actions → New repository secret

  RELEASE_KEYSTORE_BASE64   conteúdo de $B64
  RELEASE_STORE_PASSWORD    a senha que você digitou
  RELEASE_KEY_PASSWORD      a mesma senha (PKCS12 usa uma só)
  RELEASE_KEY_ALIAS         $ALIAS

Depois de cadastrar, apague $B64 e faça backup de $KEYSTORE
(ex.: gerenciador de senhas ou pendrive guardado), junto com a senha.
EOF
