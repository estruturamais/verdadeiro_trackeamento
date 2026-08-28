# Verdadeiro Trackeamento

Sistema de **rastreamento server-side** de conversões para infoprodutos, rodando em
[Cloudflare Workers](https://workers.cloudflare.com/) + D1. Ele recebe os webhooks de compra
aprovada dos gateways de pagamento, faz a correspondência com a sessão do visitante e envia os
eventos — com atribuição correta — para as plataformas de anúncios. O resultado é um dado de
conversão confiável (CAPI/server-side) que sobrevive a bloqueadores e à perda de cookies, gerando
**resultados A+** para as campanhas.

**O que ele faz, em uma frase:** um pequeno script no `<head>` do site captura a jornada do
visitante; um Worker recebe os webhooks dos gateways e dispara os eventos para Meta, TikTok, GA4,
Google Ads e Planilhas — tudo com o mesmo `eventID`, deduplicado e atribuído.

## Quem mantém

Criado e mantido pelo perfil **[@estruturamais](https://instagram.com/estruturamais)** — Augusto
Maia. O sistema foi desenhado para ser instalado por um assistente (agente) que conduz o cliente do
zero até o tracking validado em produção.

## Versão

**Versão atual: 1.6.0**

Para saber qual versão uma instalação roda, pergunte ao assistente *"qual a versão do seu VT?"* — ele
lê o número (a) deste README e do `package.json` e (b) **direto da Cloudflare**: na 1ª linha do script
servido em `https://{dominio}/tracking/web.js` (e no campo `vt_version` do config do script). A via
(b) sobrevive mesmo que o usuário apague os arquivos locais. O histórico abaixo mapeia cada versão às
novidades:

- **1.6.0** — **Google Ads: conversão offline pela Data Manager API**. O `purchase` server-side no
  Google Ads deixa de ser um `501 TODO` e passa a subir de verdade — pelo único caminho que a Google
  ainda aceita: desde 2026 o `ConversionUploadService` está **bloqueado para integrações novas**
  (`CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`), e o substituto é a **Data Manager API**
  (`events:ingest`), que nem usa developer-token — só OAuth. O gate do purchase deixou de exigir
  rótulo: a ação de conversão de **importação** (`UPLOAD_CLICKS`), que é justamente a do purchase
  server-side, **não tem rótulo nenhum**, e gatear por rótulo fazia toda venda morrer antes de
  qualquer log — indistinguível de "não houve venda". Agora vale a regra **ação de site → rótulo,
  ação de importação → id numérico**, e nenhum caminho do conector sai sem gravar log: o que falta
  vira **erro acionável** no D1 (API não habilitada no Cloud, escopo `datamanager` ausente, id da
  ação não preenchido — cada um com onde achar o que falta). O telefone passa a ser hasheado em
  **E.164** só para o Google (o hash padrão do Meta nunca casava — perda silenciosa, sem erro), e o
  `gclid`/`wbraid`/`gbraid` passam a ser **capturados e guardados** no `user_store`, que é o que
  permite atribuir a venda ao clique (e responder "houve clique?" numa auditoria). O script
  `npm run gads:oauth` emite o refresh token com os **dois** escopos (`adwords` + `datamanager`) e
  **confere o que a Google devolveu**, falhando ali em vez de em produção — token antigo nunca ganha
  escopo novo. `page_view` e `initiate_checkout` deixam de ser `null` no mapeamento e viram opt-in
  por rótulo (sem rótulo, nada dispara): quem decide o que é conversão é o cliente, no painel.
  **Mudança de comportamento:** o default de `channel` passa de `server` para `web` — o default
  antigo era uma armadilha, porque o navegador não disparava **e** o Worker gravava `200` mesmo
  assim (zero conversão com o D1 verde). Os dois canais agora operam **simultaneamente**: navegador
  por rótulo, compra por id numérico. O playbook `google_ads.md` foi reescrito a partir do conector
  real e o `audit-tracking` ganhou a seção **2.10**, com o diagnóstico da própria Google
  (`offline_conversion_upload_*`) — a única prova de que a conversão casou, já que `200` significa
  apenas *request aceito* — e a armadilha do **`EXCELLENT` com `0,00`**: o Google só reporta
  conversão atribuível a **clique**, então upload aceito sem clique é estado **normal** (no caso real
  que originou a seção, os anúncios estavam reprovados e o tracking estava perfeito). **Validado em
  produção** (diagnóstico da Google: `EXCELLENT`, `successRate 1.0`, `pending 0`).
- **1.5.0** — **Planilha de vendas via webhook + GAS universal v3 zero-config**. Toda compra
  aprovada recebida dos gateways pode virar uma linha na aba `transactions` da planilha padrão —
  novo conector `sendSheetsPurchase` (opt-in pelo bloco `sheets.purchase` no `SITE_CONFIG`; sem o
  bloco, nada muda), disparado no dispatch do webhook **depois** do dedup (reenvio do gateway não
  duplica linha; order bump entra como linha própria), com 25 colunas: comprador (via FDV merge),
  produto, oferta, método/parcelas, UTMs last-click e os três valores (`total` = o que o cliente
  pagou; `gateway` = taxa retida; `nosso` = líquido do produtor). Para isso, o contrato dos parsers
  ganhou **7 campos extras opcionais** (`offer_id`, `offer_name`, `payment_method`, `installments`,
  `order_bump`, `value_gateway`, `value_net`), preenchidos nos **12 gateways completos** a partir de
  payloads reais de compra aprovada (comissões buscadas por `source`/`type`/`role`, nunca por
  índice), e o `fdvMerge` passou a propagar os extras + UTMs. O Apps Script virou **GAS universal
  v3, zero-config**: `SpreadsheetApp.getActiveSpreadsheet()` mata o bug crítico de duplicação da
  planilha modelo (o `SHEET_KEY` hardcoded viajava no *Fazer uma cópia* e a cópia do aluno gravava
  na planilha do professor, com resposta `success`); a aba de destino vai por request (`_sheet` —
  leads e vendas na mesma implantação), com `TEXT_COLUMNS` (telefone/IDs sem notação científica),
  `NUMERIC_COLUMNS`/`coerceVal` (`lead_score` não vira `625` em planilha pt-BR), fuso da própria
  planilha e resposta com o campo `sheet` (teste de versão). O playbook `planilha.md` foi reescrito
  como condutor (leads e/ou vendas, 3 cenários de config com o mesmo `id_script`, tabela de versões
  v1/v2/v3, erros comuns novos), o `workflow.md` ganhou acionamento por intenção "planilhar" e a
  skill `new-gateway` passou a mapear os 7 extras em todo gateway novo. **Validado em produção**
  (E2E: webhook → Worker → linha real na aba `transactions`).
- **1.4.1** — **Secret com whitespace deixa de derrubar os envios (e de se disfarçar de erro de
  rede)**. Bug reproduzido em produção em dois clientes: todo envio a uma plataforma gravava
  `status_code = 0` + `Error: Network connection lost.`, com o token **correto** — o que estava errado
  era o valor no cofre, gravado com CRLF pelo pipe do PowerShell (`echo "token" | wrangler secret
  put`, o comando que os próprios playbooks recomendavam). O código passa a **higienizar toda
  credencial** na entrada de cada envio (Meta, TikTok, GA4, Sheets — header e query string) e a falhar
  de forma legível (`invalid_access_token_whitespace`) quando o valor tem whitespace no meio; o
  `catch` deixa de zerar o `status_code` quando a resposta já havia chegado (o evento pode ter sido
  aceito) e passa a distinguir `fetch_failed:` de `body_read_failed:`. Na documentação, `wrangler
  secret bulk` vira o comando canônico (portável em bash, zsh e PowerShell), o Step 3b ganha um
  **smoke test sintético obrigatório** que confirma 200/204 em cada plataforma antes de avançar — com
  retry, porque a propagação do secret no edge faz o reteste imediato falhar mesmo quando a correção
  está certa — e o `audit-tracking` ganha a tabela de assinaturas do sintoma, o roteiro de descarte e
  o alerta de que token de CAPI se valida por **envio**, nunca por leitura do pixel (que dá falso
  negativo `(#100) Missing Permission`). Inclui ainda a leitura do warning de escopos de OAuth no
  `wrangler whoami` (token antigo sobe o Worker e as rotas, mas leva `403` ao registrar o cron).
- **1.4.0** — **Funis de quiz/SPA**: o VT passa a funcionar de ponta a ponta em páginas construídas
  em JavaScript (Next.js/React/XQuiz/InLead) cujo botão de compra é um `<button>` que navega via
  `window.location` (não um `<a>`). O `InitiateCheckout` dispara no clique (server-side via
  `pagehide`, já que `Location` é `[LegacyUnforgeable]` no Chrome) e o `marca_user` chega ao checkout
  pela reescrita da URL da própria página. Tudo **opt-in e escopado por slug/subdomínio** via
  `spa_mode.locations` (cada local com o gateway pré-fixado — o `marca_user` entra no indexador
  correto p/ o FDV merge no `Purchase`): o **mesmo script** atende página tradicional **e** funil de
  quiz no mesmo site, sem toggle e sem poluir a URL de páginas tradicionais. Inclui `DEFAULT_TRIGGERS`
  (o agente não precisa mais configurar triggers canônicos), coexistência documentada com a **UTMify**,
  validação E2E do caminho do `marca_user` no onboarding e o escape hatch `disable_url_rewrite` para
  sites com modais/routers/PWA.
- **1.3.0** — **PerfectPay** com parser completo: deixa de ser skeleton e passa a processar a compra
  aprovada (evento `sale_status_enum_key = approved`), com `marca_user` em `metadata.utm_perfect`
  (parâmetro dedicado), as 5 UTMs em `metadata.*`, `value` = total pago (`sale_amount`, nunca a
  comissão do produtor) e `product_id` em `product.code`. Documentação sincronizada (gateway sai das
  listas de skeleton em README, `new-gateway`, `utm-convention.md`, `gateway-webhooks.md` e
  `reenvio_dados.md`). `.gitignore` passa a proteger `.claude/settings.local.json`.
- **1.2.0** — **analistA+** (`/analistamais`): consulta de performance **read-only** no D1 (acessos,
  origens, criativos, vendas, conversão, jornada). Captura de UTM crua nas tabelas `events` (jornada
  web) e `webhook_raw` (last-click da venda) via parsers dedicados de cada gateway; reference única
  `.claude/references/utm-convention.md` (convenção + planta por gateway). Modo de **retenção**
  configurável (`auto_clean` grátis vs `keep_all` pago) decidido na oferta opt-in pós-entrega do
  `workflow.md`. Migração `migrations/002_add_utm_columns.sql` para instalações 1.1.x.
- **1.1.1** — Versão embutida no script servido (banner na 1ª linha de `/tracking/web.js` + campo
  `vt_version`), legível via `curl` direto da Cloudflare mesmo sem arquivos locais; crédito ao
  @estruturamais no banner do script.
- **1.1.0** — Skill de auditoria de trackeamento (`/audit-tracking`); invariante do `marca_user`
  documentado como referência única (`.claude/references/marca-user.md`); `new-gateway` com coleta
  A/B/C, configuração de checkout (`gateways_config` + trigger de `initiate_checkout`), 3 cenários ao
  aguardar a 1ª venda e fallback de UTM (ex.: Eduzz com `utm_term`).
- **1.0.0** — Versão inicial: tracking server-side, parsers de gateway, plataformas de destino e
  onboarding conduzido pelo assistente.

## Plataformas e gateways suportados

- **Plataformas de destino:** Meta Ads (CAPI), TikTok Ads, GA4, Google Ads (gtag no navegador +
  conversão offline pela Data Manager API), Google Sheets.
- **Gateways com parser completo:** Hotmart, Kiwify, Kirvano, Lastlink, PagTrust, Hubla, Eduzz, Ticto,
  Green, Tutory, Payt, PerfectPay.

## Mapa de pastas e arquivos

```
.
├── src/                        # Código-fonte do sistema
│   ├── web.js                  # Script de tracking do navegador (injetado no <head> do site)
│   ├── web-template.txt        # Template do web.js servido pelo Worker (gerado pelo build)
│   └── worker/                 # Backend (Cloudflare Worker)
│       ├── index.js            # Roteador + handler de cron (scheduled)
│       ├── collect/            # Ingestão: event.js (beacon do browser) e webhook.js (gateways)
│       ├── gateways/           # Um parser por gateway + index.js (GATEWAY_PARSERS/APPROVAL_EVENTS)
│       ├── platforms/          # Um conector por destino (meta, tiktok, ga4, google-ads, sheets)
│       ├── routes/             # Endpoints auxiliares (serve-webjs, debug, logs, ga4-proxy)
│       ├── shared/             # Utilitários (config, hash, helpers, cleanup, logger, db-write)
│       └── store/              # Persistência de sessão/usuário (user-store, fdv)
│
├── .claude/                    # Documentação operacional e skills do assistente
│   ├── workflow.md             # ★ Maestro: ciclo de onboarding, roteamento e regras
│   ├── skills/                 # Skills user-invocáveis descobertas (new-gateway/, add-platform/, audit-tracking/)
│   ├── playbooks/              # Playbooks lidos por caminho pelo workflow (overview, infra, plataformas)
│   ├── references/             # Referências técnicas (formato de config, qualificação de lead, etc.)
│   └── memory_template.md      # Template do tracking_memory.md (estado entre sessões)
│
├── scripts/                    # Build (sync-webtemplate.mjs) + google-ads-oauth.mjs (refresh token do Google Ads)
├── migrations/                 # Migrações de schema do D1
├── schema.sql                  # Schema inicial do banco D1
├── config.example.json         # Exemplo do SITE_CONFIG (plataformas, gateways, qualificação)
├── wrangler.toml.example        # Exemplo da config do Worker (copiar para wrangler.toml)
└── package.json                # Scripts npm (dev/deploy/build/migrações)
```

> `wrangler.toml` e `tracking_memory.md` **não** ficam no repositório — são gerados localmente
> durante o onboarding.

## Como começar

Este repositório foi feito para ser conduzido por um assistente. **O ponto de partida é
[`.claude/workflow.md`](.claude/workflow.md)** — ele descreve o ciclo completo (implementar do zero
ou dar manutenção), o roteamento das etapas e as regras de operação.

- **Humano/agente abrindo o projeto:** leia [`.claude/workflow.md`](.claude/workflow.md) e siga o
  fluxo a partir dele.
- **Manutenção pontual:** as skills user-invocáveis estão disponíveis como slash commands —
  `/new-gateway {nome}` (adicionar/completar um gateway), `/add-platform {plataforma}` (adicionar
  uma plataforma a um tracking já implantado) e `/audit-tracking` (auditar se o tracking está
  capturando, enviando e atribuindo os eventos corretamente).

Para detalhes de configuração do servidor, autenticação e deploy, siga o `workflow.md` — ele contém
o procedimento completo e as verificações obrigatórias.
