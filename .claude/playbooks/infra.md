# Skill: tracking_infra — Setup de Infraestrutura Cloudflare

## Papel e escopo

Voce e o especialista em setup de infraestrutura Cloudflare. Seu papel e guiar o cliente passo a passo na configuracao de toda a infraestrutura necessaria para o sistema de tracking funcionar.

Esta skill e invocada **apenas no Step 0**. Apos conclusao bem-sucedida, nunca mais e necessaria.

Ao finalizar, marcar `infra_status: deployada` e "Step 0" como concluido no `tracking_memory.md`, e passar o controle para a skill `tracking_base`.

---

## Contexto tecnico do sistema

O sistema e um Cloudflare Worker com as seguintes caracteristicas (extraidas do `wrangler.toml` e `src/worker/index.js`):

- **Entry point:** `src/worker/index.js`
- **Compatibility date:** `2024-01-01`
- **workers_dev:** `false` (requer dominio proprio)
- **Banco de dados:** D1 com binding `DB`, database name `tracking_db`
- **4 rotas obrigatorias:**
  - `{dominio}/collect/*` — beacon de eventos e webhooks de gateways
  - `{dominio}/tracking/*` — serve o script `web.js` para o browser
  - `{dominio}/scripts/*` — proxy do gtag.js (GA4)
  - `{dominio}/g/*` — proxy do collect do GA4

**Rotas funcionais apos deploy:**
- `GET /tracking/web.js` — script do browser
- `POST /collect/event` — beacon de eventos em tempo real
- `POST /collect/webhook/{gateway}` — webhooks dos gateways (hotmart, kiwify, etc.)
- `GET /scripts/ga.js` — proxy gtag.js
- `GET/POST /g/collect` — proxy GA4 collect

**Tabelas D1 criadas pelo schema.sql:**
1. `user_store` — identidade do visitante (marca_user como PK, dados de browser, usuario, geolocalizacao)
2. `events` — log de todos os eventos disparados (com status_code, error_message, payload)
3. `webhook_raw` — webhooks recebidos dos gateways (UNIQUE por site_id + gateway + order_id)

---

## Sub-steps

### 0.1 — Criar conta Cloudflare

> Acesse https://dash.cloudflare.com/sign-up e crie uma conta gratuita. Me diga quando terminar.

Aguardar confirmacao antes de continuar.

---

### 0.2 — Adicionar o dominio na Cloudflare

> 🛑 **ANTES DE QUALQUER COISA, pergunte: o site e servido por uma plataforma SaaS?**
> (Lovable, Vercel, Netlify, Framer, Webflow, Bubble, Softr…)
>
> Se for, **e proibido ligar o proxy (nuvem laranja) em qualquer host da plataforma** —
> apex, subdominio do app ou dominio proprio do checkout. Isso **derrubou um site em
> producao**, e a validacao feita logo depois **passou** (HTTP 200, pagina real, sem
> Error 1000/525/526): o teste imediato e **falso negativo**, nao aprovacao — a quebra
> vem na reemissao do certificado do custom hostname, dias depois.
>
> Nesse caso use **obrigatoriamente a Opcao B** abaixo, com `track.{dominio}` como o
> **unico** host laranja. Leia `.claude/references/saas-hospedado.md` **antes** de mexer
> em DNS. Se o proxy ja estiver ligado e houver instabilidade, **voltar para nuvem
> cinza e a PRIMEIRA acao**, antes de qualquer investigacao.
>
> Recomendacoes anteriores em sentido contrario estao **revogadas**.

Perguntar ao cliente qual opcao prefere:

**Opcao A — Migrar o dominio inteiro (recomendado):**
> No painel da Cloudflare, clique em "Add a Site", digite seu dominio (ex: `seusite.com.br`) e selecione o plano gratuito. A Cloudflare vai listar os registros DNS atuais e mostrar os nameservers que voce precisa configurar no seu registrador (GoDaddy, RegistroBR, Namecheap, etc.). Copie os dois nameservers e configure no painel do seu registrador. Me diga quando fizer isso — a propagacao pode levar alguns minutos ate 24h, mas normalmente e rapido.

**Opcao B — Usar apenas um subdominio (sem migrar o dominio):**
> No painel da Cloudflare, clique em "Add a Site", selecione "Add a subdomain". Escolha um subdominio como `track.seusite.com.br`. No painel do seu DNS atual, adicione um registro CNAME apontando `track` para `{worker-name}.workers.dev`. Me diga qual subdominio quer usar.

Gravar `dominio` no `tracking_memory.md` assim que o cliente informar.

Aguardar confirmacao de que o DNS foi configurado antes de continuar.

---

### 0.3 — Verificar Node.js

Explicar: "Vou verificar se o Node.js esta instalado na sua maquina."

```bash
node --version
```

- Se instalado (v18+): continuar
- Se nao instalado ou versao antiga: "Acesse https://nodejs.org e instale a versao LTS. Me diga quando terminar."

Aguardar confirmacao antes de continuar.

---

### 0.4 — Instalar wrangler

Explicar: "Wrangler e a ferramenta de linha de comando da Cloudflare. Vou instalar ela agora."

```bash
npm install -g wrangler
```

---

### 0.5 — Autenticar wrangler na conta Cloudflare

Antes de executar o comando, orientar:

> "Antes de continuar, confirme que voce esta logado na conta CORRETA da Cloudflare no seu navegador — a conta onde o Worker vai ficar hospedado. Se voce tiver mais de uma conta Cloudflare, faca logout das outras agora e deixe so a conta certa logada. Nao troque de navegador nem de aba durante a autorizacao. Me diga quando estiver pronto."

Aguardar confirmacao antes de executar.

```bash
npx wrangler login
```

Aguardar confirmacao de que o cliente autorizou no browser antes de continuar.

---

### 0.6 — Instalar dependencias do projeto

Explicar: "Vou instalar as dependencias do projeto."

```bash
npm install
```

---

### 0.6b — Criar o arquivo de configuracao (`wrangler.toml`)

Explicar: "Vou criar o arquivo de configuracao do projeto a partir do modelo."

```bash
cp wrangler.toml.example wrangler.toml
```

O `wrangler.toml` e gitignored (nao vem no clone) — por isso e criado aqui a partir do `wrangler.toml.example`. Ele ja inclui o hook `[build]`, que sincroniza o `web-template.txt` a partir do `web.js` automaticamente em todo deploy, em qualquer SO (Windows/macOS/Linux). Os proximos sub-steps preenchem os valores: `database_id` (0.7), `{YOUR_DOMAIN}` nas rotas (0.8) e `SITE_CONFIG` (Step 3b).

---

### 0.7 — Criar banco de dados D1

Explicar: "Agora vou criar o banco de dados que armazena os dados de tracking."

```bash
npx wrangler d1 create tracking_db
```

**IMPORTANTE:** O comando retorna um bloco como este:

```
[[d1_databases]]
binding = "DB"
database_name = "tracking_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

- Copiar o `database_id` retornado
- Gravar no `tracking_memory.md`: `d1_database_id: {valor}`
- Abrir o `wrangler.toml` e substituir o `database_id` existente pelo novo ID na secao `[[d1_databases]]`

> **Copiar so o `database_id`, nunca o bloco inteiro.** Dependendo da versao, o `wrangler d1 create`
> sugere `binding = "tracking_db"` na saida — mas o codigo le `env.DB`. O `wrangler.toml` precisa
> manter `binding = "DB"`; colar o bloco sugerido como veio quebra o acesso ao banco.

**Alternativa via npm script:**
```bash
npm run db:create
```

---

### 0.8 — Atualizar routes no `wrangler.toml`

Explicar: "Vou configurar as rotas do Worker para o seu dominio."

Abrir `wrangler.toml` e substituir `{YOUR_DOMAIN}` pelo dominio do cliente em todos os 4 patterns:

```toml
routes = [
  { pattern = "{dominio}/collect/*", zone_name = "{dominio}" },
  { pattern = "{dominio}/tracking/*", zone_name = "{dominio}" },
  { pattern = "{dominio}/scripts/*", zone_name = "{dominio}" },
  { pattern = "{dominio}/g/*", zone_name = "{dominio}" }
]
```

Onde `{dominio}` e o dominio informado no sub-step 0.2 (ex: `seusite.com.br` ou `track.seusite.com.br`).

Aguardar confirmacao do cliente antes de executar o deploy ("Vou configurar as rotas para `{dominio}`. Pode continuar?").

---

### 0.9 — Aplicar schema do banco

Explicar: "Vou criar as 3 tabelas necessarias no banco de dados: registros de visitantes, log de eventos, e webhooks dos gateways."

```bash
npx wrangler d1 execute tracking_db --remote --file=./schema.sql
```

**Alternativa via npm script:**
```bash
npm run db:migrate
```

---

### 0.10 — Deploy do Worker

Explicar: "Agora vou publicar o sistema na Cloudflare. Isso pode levar cerca de 30 segundos."

```bash
npx wrangler deploy
```

**Alternativa via npm script:**
```bash
npm run deploy
```

Aguardar confirmacao do cliente antes de executar ("Vou fazer o deploy do sistema. Pode continuar?").

**O deploy pode falhar PARCIALMENTE — ler a saida inteira.** Se aparecer:

```
Uploaded tracking-worker (7.61 sec)
Deployed tracking-worker triggers (12.26 sec)
X [ERROR] Some triggers failed to deploy for tracking-worker:
    - A request to the Cloudflare API (/accounts/{id}/workers/scripts/{worker}/schedules) failed.
```

isso **nao** significa deploy perdido: o Worker e as rotas ja subiram — so o cron falhou. Confirmar
com `curl https://{dominio}/tracking/web.js` (o 0.11 ja faz isso) e tratar **so** o cron. A causa
tipica e um token do `wrangler login` criado antes dos escopos atuais, que devolve `403` no endpoint
de `schedules` (o log so mostra o `403` com `WRANGLER_LOG_SANITIZE=false` ou lendo o arquivo de log).
Correcao: `npx wrangler login` → reconfirmar a conta (REGRA BLOQUEANTE) → `npx wrangler triggers deploy`.
O `wrangler whoami` **ja avisa antes** disso — ver a regra bloqueante no `workflow.md`. Se o cron
ficar sem registrar, anotar no `tracking_memory.md`: sem ele a retencao automatica nao roda.

---

### 0.11 — Verificar deploy

Explicar: "Vou verificar se o sistema esta funcionando corretamente."

```bash
curl https://{dominio}/tracking/web.js | head -5
```

**Resultado esperado:** A resposta deve comecar com `(function()` — isso confirma que o script do browser esta sendo servido corretamente.

**Se retornar erro (404, 500, timeout):**
- Verificar se o DNS propagou (pode levar alguns minutos)
- Verificar se as rotas no `wrangler.toml` estao com o dominio correto
- Verificar se o deploy foi bem-sucedido nos logs do wrangler
- Nao continuar para o Step 1 enquanto o curl nao retornar o script

---

### 0.12 — Verificar retencao automatica de dados

Explicar: "O cron de limpeza automatica do banco ja vem ativo por padrao no `wrangler.toml`. Nao e necessario descomentar nada. O deploy que fizemos no step 0.10 ja registrou o cron na Cloudflare."

**IMPORTANTE:** O cron funciona via sistema de trigger agendado interno da Cloudflare — ele **nao depende** do subdominio `workers.dev` estar ativo. A configuracao `workers_dev = false` e correta para producao e nao interfere de forma alguma na execucao do cron.

O `wrangler.toml` ja contem:

```toml
[triggers]
crons = ["0 3 * * *"]
```

**O que a retencao faz (ja implementado no Worker):**
- Deleta registros da tabela `events` com mais de 30 dias (coluna `timestamp`)
- Deleta registros da tabela `webhook_raw` com mais de 30 dias (coluna `timestamp`)
- Deleta registros da tabela `user_store` nao atualizados ha mais de 90 dias (coluna `updated_at`)

**IMPORTANTE:** A delecao usa as colunas de data (`timestamp`, `updated_at`) — nunca o `id`. IDs nao sao sequenciais de forma confiavel no D1 sem `sqlite_sequence`, entao usar `id` para identificar registros "antigos" seria um erro.

**Verificar se o cron foi registrado:**

```bash
npx wrangler triggers list
```

Deve aparecer o cron `0 3 * * *` associado ao Worker.

---

## Atualizacao da memoria apos Step 0

Apos verificacao bem-sucedida, atualizar o `tracking_memory.md`:

```markdown
## Infraestrutura
- cloudflare_account_id: {valor informado ou obtido via wrangler whoami}
- worker_name: tracking-worker
- d1_database_id: {valor retornado pelo d1 create}
- dominio: {valor informado pelo cliente}
- infra_status: deployada

## Status do workflow
- [x] Step 0: infraestrutura Cloudflare configurada
```

---

## Regras desta skill

1. **Aguardar confirmacao em acoes invasivas** — DNS, deploy, criacao de banco: sempre explicar e aguardar "pode continuar" antes de executar
2. **Explicar antes de executar** — em linguagem simples, sem jargao tecnico desnecessario
3. **Gravar imediatamente** — qualquer dado fornecido (dominio, database_id) vai para o `tracking_memory.md` na hora
4. **Nao continuar com erro** — se 0.11 falhar, diagnosticar antes de passar para o Step 1
5. **Nunca referenciar `site_config` D1 table** — o mecanismo de config e `SITE_CONFIG` no `[vars]` do `wrangler.toml`. Para formato correto e bugs comuns: ver `.claude/references/site-config-format.md`
6. **Opcao npm run** — sempre que existir script equivalente no `package.json`, mencionar como alternativa
7. 🛑 **Nunca proxiar host servido por plataforma SaaS** — apex, app ou checkout servidos por Lovable/Vercel/Netlify/Framer/Webflow ficam **CINZA**. So `track.{dominio}` (`AAAA 100::`) fica laranja, e e nele que ficam TODAS as Worker Routes. Ligar o proxy num host da plataforma ja derrubou site em producao, e **"validei e ficou 200" nao conta como prova** — quebra depois. Detalhe, topologia e roteiro de rollback em `.claude/references/saas-hospedado.md`

---

## Resultado esperado ao concluir

- Worker `tracking-worker` deployado na Cloudflare
- Banco D1 `tracking_db` criado com 3 tabelas: `user_store`, `events`, `webhook_raw`
- Rotas configuradas para o dominio do cliente (4 patterns)
- Cron trigger `0 3 * * *` ativo (retencao automatica de dados, executa diariamente as 03:00 UTC)
- `curl https://{dominio}/tracking/web.js` retorna `(function()`
- `tracking_memory.md` atualizado com `infra_status: deployada` e Step 0 marcado como concluido
