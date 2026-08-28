# Skill: atualizar_vt

## Papel

Voce conduz a **atualizacao de um Verdadeiro Trackeamento ja instalado e rodando em producao** para
uma versao mais nova. Sua obrigacao numero um nao e entregar a versao nova: e **nao derrubar o
tracking que ja funciona**.

Carregado quando o cliente pede para atualizar/pegar a versao nova, ou quando o `audit-tracking`
detecta que a instalacao esta atras da versao do repo.

---

## As tres regras

1. **Descobrir a versao ATUAL antes de qualquer coisa.** Nao presuma. A versao do repo local nao e a
   versao no ar.
2. **Migracao de banco vem ANTES do deploy do codigo.** Nessa ordem, o codigo novo encontra o banco
   pronto. Na ordem inversa existe uma janela em que o codigo novo fala com um banco velho.
3. **Toda migracao e aditiva** (`ADD COLUMN`) — nenhuma apaga dado nem muda coluna existente. Rodar
   uma migracao ja aplicada **falha** (SQLite nao tem `ADD COLUMN IF NOT EXISTS`), e falhar assim e
   inofensivo: nao escreve nada. Nunca "consertar" isso apagando tabela.

---

## Passo 1 — Qual versao esta no ar?

A fonte da verdade e a **Cloudflare**, nao o arquivo local (o cliente pode ter apagado ou trocado de
computador):

```bash
curl -s https://{dominio}/tracking/web.js | head -1
```

Devolve `/*! Verdadeiro Trackeamento v1.5.0 | criado por @estruturamais | ... */`.

Se nao responder, cair para o `package.json` local e avisar que a leitura foi indireta.

Compare com a versao do repo (`package.json` / topo do `README.md`). **Iguais → nao ha o que fazer**:
dizer isso ao cliente e encerrar.

## Passo 2 — O que muda entre a versao dele e a atual

Ler no `README.md` as entradas de historico **entre** a versao no ar e a atual (todas, nao so a
ultima) e consultar a tabela abaixo. Resumir para o cliente em uma frase por versao, em linguagem de
negocio ("suas vendas passam a cair na planilha", nao "novo conector `sendSheetsPurchase`").

| Para chegar em | Acao de banco | Acao de config | Quebra algo? |
|---|---|---|---|
| **1.6.0** | `migrations/003_add_gclid_columns.sql` | Opcional: bloco `google_ads` (ver abaixo) | Nao — ver "Mudanca de comportamento" |
| **1.2.0** | `migrations/002_add_utm_columns.sql` | — | Nao |
| **1.1.x** | `migrations/001_drop_webhook_raw_unique.sql` | — | Nao |

**Pulou versoes?** Rode as migracoes **em ordem crescente**, uma de cada vez, conferindo cada uma
antes da proxima.

### Mudanca de comportamento da 1.6.0 (unica ate hoje)

O default de `platforms.google_ads.channel` passou de `server` para `web`.

- **Quem nao usa Google Ads:** nada muda.
- **Quem usa Google Ads e ja tinha `channel` escrito no config:** nada muda — o valor explicito vence.
- **Quem usa Google Ads e OMITIU o `channel`:** antes o Worker gravava `200` e **nada era enviado a
  lugar nenhum** (o navegador so dispara com `channel: "web"`). Agora as conversoes de navegador
  passam a disparar de verdade. **Isso conserta uma falha silenciosa** — mas avise o cliente, porque
  ele vai ver numeros aparecendo onde antes havia zero, e isso nao e dado duplicado: e dado que antes
  se perdia.

## Passo 3 — Atualizar o codigo local

```bash
git pull
npm install
```

Se o cliente editou arquivos do repo, `git pull` reclama. **Nao resolver com `git checkout .`** sem
antes mostrar o que seria descartado (`git status` + `git diff`): pode ser um ajuste que a instalacao
depende.

O `wrangler.toml` e o `tracking_memory.md` **nao** vem no `git pull` (estao no `.gitignore`) — os do
cliente continuam intactos. Confirme que o `wrangler.toml` segue preenchido antes de seguir.

## Passo 4 — Migracao do banco (ANTES do deploy)

REGRA BLOQUEANTE de conta Cloudflare primeiro (`npx wrangler whoami` — ver `workflow.md`). Depois,
para cada migracao pendente do Passo 2:

```bash
npx wrangler d1 execute tracking_db --file=./migrations/003_add_gclid_columns.sql --remote
```

Confirmar que aplicou:

```bash
npx wrangler d1 execute tracking_db --remote --command "PRAGMA table_info(user_store);"
```

Deve listar `gclid`, `wbraid`, `gbraid`.

> **Se der `duplicate column name`:** a migracao ja tinha sido aplicada. **Nao e erro** — siga em
> frente. Confirme com o `PRAGMA` acima e pronto.

> **Se voce nao conseguir rodar a migracao agora** (sem acesso, sem tempo): pode deployar mesmo
> assim. O codigo detecta a coluna ausente, **continua gravando o `user_store` normalmente** e escreve
> um aviso no log do Worker. O unico efeito e o `gclid` nao ser guardado — a conversao offline do
> Google Ads perde a atribuicao por clique, o resto do tracking segue intacto. Rode a migracao depois
> e ela volta a funcionar sozinha, sem novo deploy.

## Passo 5 — Config novo (so o que a versao pede)

A 1.6.0 nao exige config novo. **Se o cliente usa Google Ads e quer a conversao de compra
server-side**, ai sim carregar `.claude/playbooks/google_ads.md` e coletar `customer_id`,
`conversion_action_id_purchase` e as credenciais OAuth. Sem isso, o Google Ads continua funcionando
como antes, pelo navegador.

Editar o `SITE_CONFIG` **acrescentando** as chaves novas — nunca colar por cima o
`config.example.json` inteiro, que apagaria a configuracao real do cliente.

## Passo 6 — Deploy

```bash
npm run deploy
```

O `[build]` regenera o `web-template.txt` automaticamente — nao editar esse arquivo a mao.

## Passo 7 — Confirmar que subiu e que nada quebrou

```bash
# 1. a versao no ar mudou?
curl -s https://{dominio}/tracking/web.js | head -1

# 2. os eventos continuam chegando? (janela curta, logo apos o deploy)
npx wrangler d1 execute tracking_db --remote --command \
  "SELECT platform, channel, status_code, COUNT(*) FROM events WHERE timestamp > datetime('now','-15 minutes') GROUP BY 1,2,3;"
```

Criterio: **as mesmas plataformas que apareciam antes continuam aparecendo, com os mesmos status.**
Uma plataforma que sumiu da lista, ou que trocou `200` por `0`, e regressao — investigar pelo
`audit-tracking` antes de dar a atualizacao por concluida.

Se o site tem pouco trafego e a janela vier vazia, use o **smoke test sintetico** do Step 3b.5 do
`overview.md` em vez de esperar.

## Passo 8 — Registrar

Atualizar no `tracking_memory.md`: versao, data da atualizacao e quais migracoes foram aplicadas.
Sem isso, a proxima sessao nao sabe de onde partir.

---

## Rollback

Nenhuma migracao apaga dado, entao voltar o codigo e seguro — as colunas novas simplesmente ficam
sem uso:

```bash
git checkout {tag-ou-commit-anterior}
npm run deploy
```

Para achar o ponto de volta: `git tag` lista as versoes tagueadas e
`git log --oneline --grep="^release"` lista **todos** os commits de release (nem toda versao ganhou
tag). **Nao** tente reverter a migracao: `DROP COLUMN` em SQLite/D1 e mais arriscado do que a coluna
ociosa que voce quer remover.

---

## Erros comuns

| Sintoma | Causa | Correcao |
|---|---|---|
| `duplicate column name: gclid` | Migracao ja aplicada | Nao e erro — seguir em frente |
| `no such table: user_store` | Banco errado, ou `wrangler.toml` apontando para outro D1 | Conferir `database_id` no `wrangler.toml` e a conta no `whoami` |
| `git pull` recusa por alteracao local | O cliente editou arquivos do repo | Mostrar o `git diff` **antes** de decidir descartar |
| Deploy OK e o `curl` ainda mostra a versao antiga | Cache de edge | Aguardar e repetir; conferir tambem `?v=` no browser |
| Aviso `colunas de click id ausentes` no log | Deploy feito sem a migracao | Rodar a migracao (Passo 4). Nada quebrou |
| `Some triggers failed to deploy` | Escopos do token do wrangler | `npx wrangler login` de novo e `npx wrangler triggers deploy` (ver `infra.md`) |
