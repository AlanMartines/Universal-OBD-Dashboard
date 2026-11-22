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

## Área pública

`/projeto`, `/sobre` e `/projeto/placa` abrem sem login: apresentação, propósito do projeto e a placa da escuta CAN em 3D, com link para o GitHub. Não mostram dado de ninguém. O visor 3D (`placa3d.mjs`) usa o Three.js do `node_modules`, servido em `/vendor/three/` como as outras bibliotecas. As posições das peças (`modelo3d-dados.js`) são uma cópia gerada por `veiculos/fiat-uno-vivace-2012/placa/gerar_3d.py`, e um teste confere se está igual.

## Organização do código

```
web/src/modules/<módulo>/   routes.js, views/ e public/ (JS e CSS só daquela tela)
web/src/shared/             layout, componentes, tema (tokens.css), paginação e avisos
api/src/routes/             uma rota por recurso, com pagination.js e session.js em comum
```

Cada página carrega apenas os arquivos do próprio módulo. Listagens são paginadas no servidor, com links que funcionam sem JavaScript.

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
- aceitar corpo de pelo menos 6 MB, por causa da foto de perfil (por exemplo, `client_max_body_size 10M`).

Com `HTTP_BIND=0.0.0.0`, libere `HTTP_PORT` no firewall só para o proxy. O Docker publica portas passando por cima de regras comuns do `ufw`, então confira a cadeia `DOCKER-USER`. Se a porta ficar aberta, é possível falsificar o IP de origem e escapar dos limites por IP. Se o proxy estiver em um IP público, informe esse IP em `TRUST_PROXY`.

## Mapa do percurso

O percurso usa um mapa do próprio servidor: as posições não saem para nenhum serviço externo. Para instalar, rode uma vez, dentro de `server/`:

```bash
sh scripts/baixar-mapa.sh
docker compose up -d web
```

O script precisa de Docker e de alguns GB livres, e o tempo depende da internet. Sem o arquivo, o traçado aparece sem as ruas. O Super Admin só vê a localização de outras contas no modo suporte, que fica registrado na auditoria. Dados do mapa: © OpenStreetMap, por meio do Protomaps.

### Percurso nas ruas (opcional)

O GPS do celular costuma ficar alguns metros fora da rua, e entre duas posições a linha corta as esquinas. Com o **OSRM** rodando no próprio servidor, o painel encaixa o traço nas ruas, como os apps de entrega. É só desenho: as posições gravadas, a distância e o consumo não mudam, e o botão **Ajustar às ruas** mostra o traço bruto do GPS.

```bash
sh scripts/preparar-rotas.sh
# no .env: COMPOSE_PROFILES=rotas e OSRM_URL=http://osrm:5000
docker compose up -d
```

O script baixa as ruas do Brasil do OpenStreetMap (~1,8 GB, pela Geofabrik) e processa com o perfil de carro: 30 a 60 minutos. Com o Brasil inteiro, o contêiner `osrm` ocupa cerca de 9 GB de memória e 13 GB de disco; para gastar menos, use só a sua região (`OSRM_PBF_URL` com um recorte da Geofabrik, como `south-america/brazil/<região>-latest.osm.pbf`) ou acrescente `--mmap` ao comando do `osrm` no compose, que lê o mapa do disco sob demanda. Só a API fala com ele, por rede interna. Sem o OSRM, o painel desenha o traço do GPS e nada mais muda. Para atualizar as ruas, rode o script de novo: o serviço no ar segue com os dados antigos até o fim do processamento. Trecho que não encaixa (estacionamento, rua nova, sinal ruim) aparece como o traço do GPS.

## Conta

O login aceita usuário ou e-mail. Em **Meus Dados**, a pessoa altera nome, foto, e-mail e senha.

- **E-mail:** o novo endereço só vale depois de abrir o link enviado a ele, válido por 1 hora. A troca pede a senha atual e avisa o endereço antigo.
- **Foto:** JPG, PNG ou WebP de até 5 MB. A imagem é regravada em 256 × 256, sem metadados como GPS, e fica no banco, visível só com login.

- **Verificação em duas etapas:** aplicativo autenticador (TOTP), com chave cifrada no banco e 10 códigos de recuperação de uso único.
  - **Obrigatória para o Super Admin.** Depois da troca da senha inicial, o painel só libera Meus Dados até o 2FA ser ativado, e ele não pode ser desativado pela tela.
  - **Para os donos de conta (Admin):** opcional por padrão. Em Configurações, o Super Admin pode exigi-la de todos; quem ainda não ativou passa pelo mesmo bloqueio no próximo acesso.
  - O perfil Usuário (atendimento) continua com o 2FA opcional, e o modo suporte nunca pede o 2FA da conta visitada.
  - **Celular novo:** em Meus Dados, "Trocar o aplicativo autenticador" pede a senha e um código do aplicativo atual (ou de recuperação) e mostra o QR novo. O aplicativo antigo vale até o código do novo ser confirmado; depois, os códigos de recuperação são trocados, as outras sessões caem e chega um aviso por e-mail. Serve também para gerar códigos de recuperação novos.
  - **Perdeu o celular e os códigos:** só pelo servidor, com o reset de senha e `--disable-2fa` (veja Reset de senha).
- **Sessões ativas:** a pessoa vê onde está conectada e encerra o que não reconhecer.
- **Esqueci minha senha:** link de 1 hora para o e-mail confirmado. A resposta não revela se o e-mail existe.
- **Modo suporte:** o Super Admin entra como outra conta por até 1 hora, com faixa visível e registro na auditoria. Senha, e-mail, 2FA e dados pessoais ficam bloqueados.

### Proteger a auditoria (uma vez por instalação)

Depois que a API aplicar a migração 012, rode como dono do banco:

```bash
sudo scripts/proteger-auditoria.sh
```

O script passa a tabela e a função de limpeza para o dono e cria a trava contra o `DROP`. Pode rodar de novo sem problema, e a proteção vai junto no backup. Uma migração futura que precise alterar o `audit_log` tem de rodar como dono.

## Reset de senha

Vale para qualquer usuário, desde que o nome esteja correto:

```bash
# Gera uma senha aleatória e mostra uma única vez
docker compose exec api node bin/user-reset-password.js --user NOME

# Pede a senha sem mostrar na tela (recomendado)
docker compose exec api node bin/user-reset-password.js --user NOME --prompt

# Define a senha informada (fica no histórico do terminal)
docker compose exec api node bin/user-reset-password.js --user NOME --password 'SENHA'
```

Se a pessoa perdeu o autenticador e os códigos, acrescente `--disable-2fa` ao comando. Quando o 2FA é obrigatório para o perfil dela, o painel pede um novo autenticador logo depois da troca de senha.

O reset encerra as sessões do usuário, libera o bloqueio e exige nova troca no próximo login.

## Pareamento de dispositivos

1. A pessoa dá um nome ao aparelho no painel e recebe um código válido por 10 minutos, de uso único.
2. O app envia o código e um UUID aleatório gerado na instalação.
3. O servidor devolve um token próprio do aparelho, revogável pelo painel.

O app não usa IMEI nem MAC. O UUID só identifica a instalação; quem autentica é o token. No banco fica apenas o hash do token.

## API do aparelho

Só estas três rotas são públicas:

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

`POST /api/v1/live`, com o mesmo token: a última leitura para o **Painel do veículo** (`{ "ts", "metrics", "dtcs", "gps" }`). Não é gravada no banco. A resposta `{ "viewers", "accepted" }` só serve para o app reduzir o envio quando ninguém está olhando.

- Cada pacote aceita até 500 amostras.
- `seq` cresce por instalação; repetir um pacote não duplica dados.
- Campos fora do contrato são recusados com 400. VIN não faz parte do contrato.
- `gps` é opcional.
- Amostras com horário mais de 5 minutos no futuro ou mais de 30 dias no passado são descartadas e contadas em `rejected`.

## Segurança

- **Senhas:** Argon2id, mínimo de 15 caracteres e resposta igual para usuário inexistente, senha errada ou bloqueio.
- **Senhas vazadas:** no cadastro, na troca e na redefinição, a senha nova é conferida no Have I Been Pwned por k-anonimato: só os 5 primeiros caracteres do SHA-1 saem do servidor (pelo contêiner `web`, o único com saída). Se ela aparece em vazamentos, é recusada. Se o serviço não responde, a senha passa. `PWNED_CHECK=false` desliga.
- **Papéis testados rota a rota:** um teste confere que o Usuário (atendimento) é recusado em todas as rotas de gestão e que o Admin é recusado nas rotas só do Super Admin.
- **Confirmar a senha em ações críticas:** criar, desativar ou excluir usuário, abrir o cadastro, mudar a exigência de 2FA dos donos de conta, entrar em modo suporte e gerar código de pareamento, revogar ou excluir dispositivo exigem que a senha (e o código do autenticador, se a conta usa 2FA) tenha sido confirmada nos últimos 10 minutos. O login conta como confirmação; o modo suporte e a volta dele não. Sem confirmação recente, o painel leva a "Confirme sua senha" e volta à página de onde a ação partiu (só para endereços do próprio painel). No modo suporte, quem confirma é o Super Admin, com a senha e o 2FA dele. Confirmações e recusas ficam na auditoria.
- **Bloqueio por tentativas, por rede:** as senhas erradas contam por conta e por rede de origem (/24 no IPv4, /48 no IPv6). Depois de 5 erros, só aquela rede fica bloqueada, de forma progressiva até 60 min. Assim, quem sabe o seu usuário não consegue te deixar do lado de fora. Se a conta somar 20 erros vindos de vários lugares (ataque espalhado), ela fecha só para redes que nunca usou; das redes de onde o dono já entrou no último ano, o login segue funcionando. Um login certo, a troca ou a redefinição de senha zeram a contagem.
- **Sessão:** cookie `__Host-`, `HttpOnly`, `Secure` e `SameSite=Lax`, guardada no banco só como hash.
- **Web:** token CSRF com conferência de `Sec-Fetch-Site` e `Origin`, CSP sem scripts ou estilos embutidos e escape automático do Handlebars. Nada vem de CDN.
- **Banco:** consultas sempre parametrizadas, feitas por um papel sem privilégios de superusuário.
- **Auditoria protegida:** a tabela `audit_log` pertence ao dono do banco. O papel da aplicação só consulta e registra: não apaga, não altera, não esvazia e não derruba a tabela (uma trava no banco barra o `DROP`). A limpeza do que passou de 1 ano é feita pela função `audit_purge()`. Quem invadir a API não apaga os próprios rastros.
- **Robôs:** limites por IP, campo invisível nos formulários, token de formulário assinado e tempo mínimo de preenchimento no cadastro, que vem fechado por padrão.
- **Alertas por e-mail:** a própria conta recebe um aviso quando:
  - uma rede fica bloqueada por senhas erradas, ou a conta fecha para redes novas (um aviso por sequência);
  - alguém acerta a senha, mas erra o código do autenticador até o fim;
  - um Super Admin ou Admin entra de uma rede nova (outra faixa /24 no IPv4 ou /48 no IPv6), comparada com os logins do último ano;
  - um aparelho é pareado;
  - a verificação em duas etapas é desligada, pela tela ou pela linha de comando.

  O Usuário (atendimento) sem e-mail avisa o dono da conta. Sem e-mail cadastrado, nada é enviado. Os avisos usam a fila do `mailer` e nunca levam senha, código ou token.
- **Contas:** uma conta nunca acessa dispositivos de outra; só o superadmin vê todos. Ações sensíveis ficam na auditoria, sem senhas nem tokens.

### Limitações atuais

- Sem e-mail, o cadastro revela se um nome de usuário já existe. O limite de tentativas reduz esse risco, mas não o elimina.
- O limite por IP não segura uma rede grande de robôs. Antes de abrir o cadastro ao público, avalie proteção adicional no proxy.
- Os dados, incluindo GPS, não são cifrados campo a campo. Cifre o disco da VPS e os backups.
- O tempo real roda em um único processo da `api`.

## Backup do banco

`scripts/backup-banco.sh` faz um backup diário cifrado do PostgreSQL, e `scripts/testar-restauracao.sh` confere todo mês se ele de fato restaura.

- **O que vai:** o dump do banco (`pg_dump -Fc`), os papéis (`pg_dumpall --globals-only`) e uma cópia do `.env`. Tudo é cifrado com GPG (AES-256) antes de tocar o disco.
- **Conferência:** cada backup é decifrado por inteiro e listado pelo `pg_restore` antes de entrar na pasta.
- **Logs:** os logs dos contêineres das últimas 24 h também entram, cifrados (levam IPs e nomes de usuário), na pasta `logs/`, por 30 dias. Se o servidor cair, os logs não se perdem com ele.
- **Retenção:** 7 diários, 4 semanais (domingo) e 6 mensais (dia 1), em `/usr/local/obdBackup`, espelhados por `rclone` num armazenamento externo. O `--max-delete` impede que uma pasta local vazia apague o remoto.
- **Teste de restauração:** sobe um Postgres descartável, sem rede, restaura o backup mais recente e confere as tabelas, as migrações e os usuários contra a produção.

### Instalação

```bash
sudo install -d -m 700 /etc/obd-backup
# Frase do GPG: guarde uma cópia num gerenciador de senhas. Sem ela, o backup não abre.
sudo sh -c 'umask 077; openssl rand -base64 48 | tr -d "\n" > /etc/obd-backup/senha'
# Destino do rclone (um remoto já configurado em "rclone config")
sudo sh -c 'umask 077; echo "REMOTO=meu-remoto:bucket/obd" > /etc/obd-backup/backup.conf'
```

A frase e a configuração ficam em `/etc/obd-backup`, fora da pasta do projeto: se a pasta pessoal também for copiada para a nuvem, a chave não viaja junto com os arquivos cifrados.

No `crontab -e` do root (ajuste o caminho):

```cron
30 2 * * * /bin/bash /caminho/server/scripts/backup-banco.sh >> /var/log/obd-backup.log 2>&1
30 4 2 * * /bin/bash /caminho/server/scripts/testar-restauracao.sh >> /var/log/obd-backup.log 2>&1
```

Para rodar à mão sem enviar: `SEM_ENVIO=1 sudo scripts/backup-banco.sh`.

### Restaurar na produção

Só em caso de perda do banco. Pare o que escreve nele, recrie o banco vazio e restaure:

```bash
docker compose stop api worker web
F=/usr/local/obdBackup/diario/obd-AAAA-MM-DD.dump.gpg
docker compose exec -T db dropdb -U obd_owner obd
docker compose exec -T db createdb -U obd_owner obd
gpg --batch --pinentry-mode loopback --passphrase-file /etc/obd-backup/senha -d "$F" \
  | docker compose exec -T db pg_restore -U obd_owner -d obd --exit-on-error
docker compose start api worker web
```

Num servidor novo, restaure antes o `.env` (`gpg -d obd-AAAA-MM-DD.env.gpg > .env`), suba só o `db` e siga os mesmos passos. O papel da aplicação é criado pelo `db/init` com a senha do `.env`.

## Monitor do servidor

`scripts/monitor-servidor.sh` roda pelo cron a cada 10 minutos e avisa os Super Admins por e-mail, pela mesma fila do painel (não precisa de SMTP no servidor), quando:

- o disco passa de 85 % de uso (`/`, diretório do Docker e pasta dos backups);
- a memória disponível fica abaixo de 10 %;
- algum contêiner do painel para, fica reiniciando ou com a saúde ruim;
- o último backup bem-sucedido tem mais de 26 h.

Cada problema avisa ao aparecer e repete no máximo a cada 6 h enquanto durar. Quando normaliza, sai um aviso de "normalizado". O estado fica em `/var/lib/obd-monitor`, e o aviso só é marcado como enviado depois que a fila aceita (com o banco fora do ar, ele tenta de novo na próxima rodada). Os limites mudam por variável (`DISCO_LIMITE`, `MEMORIA_MIN`, `BACKUP_MAX_HORAS`, `REPETIR_HORAS`), e `SEM_ENVIO=1` só mostra o resultado.

```cron
*/10 * * * * /bin/bash /caminho/server/scripts/monitor-servidor.sh >> /var/log/obd-monitor.log 2>&1
```

## Homologação

Um segundo painel no mesmo servidor, para testar uma versão (migrações, atualização de dependências, mudança grande) antes de ela chegar à produção. Quem cuida é o `scripts/homologacao.sh`:

- **Isolamento:** projeto do Compose `obd-homolog`, com contêineres, redes, imagens e banco próprios. A faixa da rede `routing` muda pelo `ROUTING_SUBNET`.
- **Cópia separada do código:** roda de um git worktree em `<repo>-homolog`. Trocar a versão da homologação nunca mexe na pasta da produção.
- **Acesso só pelo túnel SSH:** fica em `127.0.0.1:28480`, sem Nginx e sem HTTPS (por isso o `ALLOW_INSECURE_COOKIE=true`):

  ```bash
  ssh -L 28480:127.0.0.1:28480 <servidor>     # depois abra http://localhost:28480
  ```
- **Sem e-mail:** a homologação não tem SMTP. Alertas e redefinições ficam na fila e somem em um dia.
- **Configuração:** em `/etc/obd-homolog/homolog.env`, fora do Git, com segredos próprios. A chave do 2FA é a da produção, para o login com 2FA funcionar com os dados copiados.

```bash
sudo scripts/homologacao.sh preparar             # uma vez: cria a configuração
sudo scripts/homologacao.sh subir                # master; ou uma ref, ex.: origin/feat/x depois de um git fetch
sudo scripts/homologacao.sh copiar-producao      # banco da homologação = backup cifrado mais recente da produção
sudo scripts/homologacao.sh estado
sudo scripts/homologacao.sh parar                # o banco da homologação fica
```

O `copiar-producao` usa o backup do `scripts/backup-banco.sh`, nunca o banco da produção ao vivo, e apaga da cópia as sessões, os desafios de 2FA, os links e os e-mails pendentes. Depois dele, o login é o mesmo da produção. O `subir` seguinte aplica nesse banco as migrações da versão em teste.

## Testes

Precisam de um PostgreSQL descartável, porque **o banco indicado é apagado a cada execução**:

```bash
docker run -d --rm --name obd-test-db -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=obd_test \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
export TEST_DATABASE_URL=postgres://postgres:teste@127.0.0.1:55432/obd_test
(cd api && npm ci && npm test)
(cd web && npm ci && npm test)
```
