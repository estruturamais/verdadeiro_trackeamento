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

**Versão atual: 1.2.0**

Para saber qual versão uma instalação roda, pergunte ao assistente *"qual a versão do seu VT?"* — ele
lê o número (a) deste README e do `package.json` e (b) **direto da Cloudflare**: na 1ª linha do script
servido em `https://{dominio}/tracking/web.js` (e no campo `vt_version` do config do script). A via
(b) sobrevive mesmo que o usuário apague os arquivos locais. O histórico abaixo mapeia cada versão às
novidades:

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

- **Plataformas de destino:** Meta Ads (CAPI), TikTok Ads, GA4, Google Ads, Google Sheets.
- **Gateways com parser completo:** Hotmart, Kiwify, Kirvano, Lastlink, PagTrust, Hubla, Eduzz, Ticto,
  Green, Tutory, Payt.
- **Gateways com parser skeleton** (completáveis via skill `new-gateway`): PerfectPay.

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
├── scripts/                    # Build (sync-webtemplate.mjs gera o web-template.txt a partir do web.js)
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
