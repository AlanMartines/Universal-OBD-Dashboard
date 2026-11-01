# Servidor de telemetria

Recebe do app Universal OBD os dados já tratados e mostra tudo em um painel web. O fluxo é só de ida: **o servidor nunca envia comandos ao aparelho nem ao carro**.

## Serviços

| Serviço | Função | Rede |
|---|---|---|
| `web` | Painel (Handlebars e Bootstrap locais) e única porta publicada | `edge`, `app` |
| `api` | Regras, autenticação e gravação | `app`, `backend` |
| `worker` | Limpeza periódica; se parar, o resto continua | `backend` |
| `mailer` | Envio de e-mails por SMTP, a partir de uma fila no banco; se parar, só os envios ficam pendentes | `backend`, `mail` |
| `db` | PostgreSQL, sem porta publicada | `backend` |

A `web` não alcança o banco. A `api`, o `worker` e o `db` não têm saída para a internet; só o `mailer` e a `web` têm. O HTTPS fica no seu proxy reverso.

## Instalação

```bash
cp .env.example .env   # troque todos os valores
docker compose up -d --build
```

Toda a configuração de inicialização fica no `.env`. Na primeira subida, o superadmin é criado com `ADMIN_USERNAME` e `ADMIN_PASSWORD`, e a troca de senha é exigida no primeiro login. Se já houver administrador, nada muda. O sistema não sobe com senha fraca ou com os valores de exemplo.

## Proxy reverso

Aponte o domínio de `APP_URL` para `http://IP_DO_SERVIDOR:HTTP_PORT` e configure o proxy para:

- atender só por HTTPS;
- substituir `X-Forwarded-For` pelo IP real do cliente, sem aceitar o valor enviado por ele;
- preservar o cabeçalho `Origin`;
- não reter respostas `text/event-stream`, usadas no tempo real;
- aceitar corpo de pelo menos 3 MB, por causa da foto de perfil (por exemplo, `client_max_body_size 10M`).

Com `HTTP_BIND=0.0.0.0`, libere `HTTP_PORT` no firewall só para o proxy. O Docker publica portas passando por cima de regras comuns do `ufw`, então confira a cadeia `DOCKER-USER`. Se a porta ficar aberta, é possível falsificar o IP de origem e escapar dos limites por IP. Se o proxy estiver em um IP público, informe esse IP em `TRUST_PROXY`.

## Conta

O login aceita usuário ou e-mail. Em **Meus Dados**, a pessoa altera nome, foto, e-mail e senha.

- **E-mail:** o novo endereço só vale depois de abrir o link enviado a ele, válido por 1 hora. A troca pede a senha atual e avisa o endereço antigo.
- **Foto:** JPG, PNG ou WebP de até 2 MB. A imagem é regravada em 256 × 256, sem metadados como GPS, e fica no banco, visível só com login.

## Reset de senha

Vale para qualquer usuário, desde que o nome esteja correto:

```bash
# Gera uma senha aleatória e mostra uma única vez
docker compose exec api npm run -s user:reset-password -- --user NOME

# Pede a senha sem mostrar na tela (recomendado)
docker compose exec api npm run -s user:reset-password -- --user NOME --prompt

# Define a senha informada (fica no histórico do terminal)
docker compose exec api npm run -s user:reset-password -- --user NOME --password 'SENHA'
```

O reset encerra as sessões do usuário, libera o bloqueio e exige nova troca no próximo login.

## Pareamento de dispositivos

1. A pessoa dá um nome ao aparelho no painel e recebe um código válido por 10 minutos, de uso único.
2. O app envia o código e um UUID aleatório gerado na instalação.
3. O servidor devolve um token próprio do aparelho, revogável pelo painel.

O app não usa IMEI nem MAC. O UUID só identifica a instalação; quem autentica é o token. No banco fica apenas o hash do token.

## API do aparelho

Só estas duas rotas são públicas:

`POST /api/v1/devices/register`

```json
{ "code": "ABCD-EFGH-JKLM", "installationId": "uuid", "appVersion": "1.0.0" }
```

Resposta: `{ "deviceId", "deviceName", "deviceToken" }`.

`POST /api/v1/telemetry`, com `Authorization: Bearer <deviceToken>`

```json
{
  "samples": [
    {
      "seq": 1,
      "ts": 1790000000000,
      "tripId": 7,
      "metrics": { "rpm": 900, "speed": 40 },
      "dtcs": ["P0301"],
      "gps": { "lat": 0.0, "lon": 0.0, "speedKmh": 40, "accuracyM": 5 }
    }
  ]
}
```

Resposta: `{ "received", "stored", "rejected" }`.

- Cada pacote aceita até 500 amostras.
- `seq` cresce por instalação; repetir um pacote não duplica dados.
- Campos fora do contrato são recusados com 400. VIN não faz parte do contrato.
- `gps` é opcional.
- Amostras com horário mais de 5 minutos no futuro ou mais de 30 dias no passado são descartadas e contadas em `rejected`.

## Segurança

- **Senhas:** Argon2id, mínimo de 15 caracteres, bloqueio progressivo por conta e resposta igual para usuário inexistente, senha errada ou conta bloqueada.
- **Sessão:** cookie `__Host-`, `HttpOnly`, `Secure` e `SameSite=Lax`, guardada no banco só como hash.
- **Web:** token CSRF com conferência de `Sec-Fetch-Site` e `Origin`, CSP sem scripts ou estilos embutidos e escape automático do Handlebars. Nada vem de CDN.
- **Banco:** consultas sempre parametrizadas, feitas por um papel sem privilégios de superusuário.
- **Robôs:** limites por IP, campo invisível nos formulários, token de formulário assinado e tempo mínimo de preenchimento no cadastro, que vem fechado por padrão.
- **Contas:** uma conta nunca acessa dispositivos de outra; só o superadmin vê todos. Ações sensíveis ficam na auditoria, sem senhas nem tokens.

### Limitações atuais

- Ainda não há autenticação em dois fatores nem consulta a bases de senhas vazadas; existe só uma lista local de senhas comuns.
- Sem e-mail, o cadastro revela se um nome de usuário já existe. O limite de tentativas reduz esse risco, mas não o elimina.
- O limite por IP não segura uma rede grande de robôs. Antes de abrir o cadastro ao público, avalie proteção adicional no proxy.
- Os dados, incluindo GPS, não são cifrados campo a campo. Cifre o disco da VPS e os backups.
- O tempo real roda em um único processo da `api`.

## Testes

Precisam de um PostgreSQL descartável, porque **o banco indicado é apagado a cada execução**:

```bash
docker run -d --rm --name obd-test-db -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=obd_test \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
export TEST_DATABASE_URL=postgres://postgres:teste@127.0.0.1:55432/obd_test
(cd api && npm ci && npm test)
(cd web && npm ci && npm test)
```
