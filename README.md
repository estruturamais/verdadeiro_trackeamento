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

**Versão atual: 1.9.1**

Para saber qual versão uma instalação roda, pergunte ao assistente *"qual a versão do seu VT?"* — ele
lê o número (a) deste README e do `package.json` e (b) **direto da Cloudflare**: na 1ª linha do script
servido em `https://{dominio}/tracking/web.js` (e no campo `vt_version` do config do script). A via
(b) sobrevive mesmo que o usuário apague os arquivos locais. O histórico abaixo mapeia cada versão às
novidades:

- **1.9.1** — **`fbp` no `PageView` desde a 1ª página, `page_view` do GA4 pelo navegador (identidade
  certa em qualquer container), identidade sempre em `marca_user` e um onboarding que desliga o que
  contaria em dobro.** **`fbp`:** o `web.js` é o 1º elemento do `<head>` e
  o cookie `_fbp` só nasce depois que o pixel da Meta carrega — na 1ª página do visitante o beacon do
  `page_view` saía antes, e o `PageView` da CAPI ia sem `fbp` (a espera pelo gtag da 1.9.0 já tinha
  levado a cobertura de cerca de 32% para 65% de carona). Agora, com Meta no config, o `page_view`
  espera também o `_fbp`, no mesmo teto de 3 s do `<title>` e do gtag, e sai no `pagehide` se o
  visitante for embora antes; sem Meta, e nos cliques, nada espera. **`cookies.user` removido:** a
  chave de identidade no navegador volta a ser sempre `marca_user`; o bloco `cookies` do `SITE_CONFIG`
  passa a ser ignorado (o `email`/`phone`/`name` dele nunca fizeram efeito) e saiu do
  `config.example.json`. Sem `cookies.user` no config nada muda; quem o configurou volta a
  `marca_user`, e o visitante que só tinha o id na chave antiga ganha id novo. **Onboarding:** o
  checklist de integrações antigas passa a rodar **antes** do teste de webhook e do go-live —
  integração GA4 nativa do gateway, tags do GA4 no GTM, webhooks antigos de servidor (Stape, sGTM),
  Meta, TikTok e Google Ads —, cada item com o jeito de confirmar que saiu; a entrega do Step 6 vira
  três blocos (tracking ativo / onde funciona e onde não / obrigatório desligar); o
  `platforms.ga4.unattributed_purchases` passa a ser **oferecido** depois desse checklist, com o
  trade-off dito ao cliente (a venda sem visita entra na receita, sem atribuição) e sem resposta = não
  liga; e "Conversões otimizadas para leads" entra como pré-requisito obrigatório do Google Ads — sem
  ele, toda venda sem `gclid` (a maioria) é recusada com
  `DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS`. **Correção:** o comando
  documentado do OAuth do Google Ads (`npm run gads:oauth --client-id=...`) não entregava as
  credenciais ao script — o npm 11 fica com as flags e o script parava pedindo o Client ID; o certo é
  `npm run gads:oauth -- --client-id=... --client-secret=...`. **GA4 — `page_view` pelo navegador:**
  há container de GA4 que só grava `_ga`/`_ga_<ID>` no 1º hit do gtag; com `send_page_view: false` o
  `gtag('get')` devolvia um `client_id`/sessão **provisórios** e o hit seguinte gravava outros — a 1ª
  página de cada visita ia para um usuário e uma sessão que não existiam (usuários e sessões
  inflados, página de entrada perdida). Agora o `page_view` do GA4 sai pelo gtag do navegador, pelo
  proxy próprio `/g/collect`, e grava os cookies na carga; o Worker deixa de mandá-lo pelo
  Measurement Protocol (contaria em dobro) e a linha `google_analytics_4 | page_view` some do D1 — o
  `page_view` se confere no Tempo real. Conversões de navegador e `purchase` seguem pelo MP, com o
  `client_id` e a sessão reais. Trade-off: bloqueador que barra o `/g/collect` perde o `page_view` do
  GA4, como em qualquer GA4; Meta e TikTok seguem server-side. O reference de configuração automática
  deixa de mandar desligar "Visualizações de página" (em site tradicional, desmarca-se só a opção do
  histórico do navegador). O `logging.retention_days` saiu do `config.example.json`: nenhum código o
  lia. **Sem migração de banco e sem config novo.**
- **1.9.0** — **GA4 com dado de verdade, Google Ads pelo navegador, identidade em `.com.br` e FDV
  merge por IP**. Release de correções de falha silenciosa, achadas e validadas em produção em
  clientes reais (Kiwify, `.com.br`). **GA4:** o `page_view` do Measurement Protocol chegava **sem
  título (100%), sem `session_id` (100%) e com data falsa** (o `timestamp_micros` era o do cookie +60 s:
  futuro, ou dias atrás), e a 1ª página do visitante novo nem saía — no GA4, "usuário ativo sem
  nenhuma página" e "usuário sem cidade". Agora o `_ga_<ID>` é lido pelo nome exato (formatos GS1 e
  GS2), o `page_view` espera o `<title>` e o gtag (teto de 3 s, envio no `pagehide`; o `client_id` vem
  do cookie primeiro, porque o `gtag('get')` devolve um id **provisório** na 1ª visita), a data é a do
  recebimento, o MP leva `ip_override`/`user_agent` do visitante e `consent.ad_personalization` no lugar
  do `non_personalized_ads` deprecado, e o proxy `/g/collect` repassa o IP. Medido no cliente: 100% com
  título e sessão, 2% sem `client_id`. Purchase sem `client_id` deixa de ser um `return` mudo e grava
  `missing_ga_client_id`; e o opt-in `platforms.ga4.unattributed_purchases` manda a venda sem visita
  com `client_id` **sintético** (nunca PII) para a receita do GA4 bater com a do gateway — no caso
  real, com o emissor antigo desligado, o GA4 mostrava R$ 0,00 com duas vendas. Pageviews e usuários
  **sobem** a partir do deploy: é dado que se perdia, não duplicidade. **Google Ads web:** o destino
  `AW-` nunca recebia `gtag('config')`, e o gtag só despacha para destino configurado — a conversão de
  navegador era descartada em silêncio (comprovado no Chrome: zero requisição com o rótulo). **Sem
  GA4** era pior: o `gtag` nem existia, o `ReferenceError` abortava o beacon e o evento sumia de
  **todas** as plataformas. Agora o `initGtag` configura cada destino, com ou sem GA4, e cada SDK de
  navegador roda isolado do beacon — falha de um nunca mais derruba o envio server-side. A linha
  `google_ads | web` do D1 deixa de prometer despacho: conversão de navegador se valida no navegador.
  **Identidade em domínio de sufixo composto:** o cookie saía com `Domain=.com.br` (rejeitado pelo
  navegador) e o checkout `pay.kiwify.com.br`/`pay.hotmart.com.br` era tratado como **interno** —
  link sem `sck`/`xcod`, venda sem FDV merge. Agora o domínio registrável conhece os sufixos de 2
  níveis, a identidade local vence a cunhada pelo servidor, e `collect_url` passa a ser configurável
  (obrigatório absoluto em page builder ou site SaaS com o tracking em `track.{dominio}` — antes, só
  com patch local). O `cookies.user` do `config.example.json`, que estava documentado e **não fazia
  nada**, passa a valer: o VT herda o id do visitante de uma solução anterior sem zerar a base
  (`email`/`phone`/`name` seguem sem efeito). **FDV merge por IP do dispositivo** (opt-in
  `fdv.ip_fallback`): 3º caminho, depois do indexador e do e-mail — a venda que chega sem código de
  rastreio (link de checkout sem parâmetros, recuperação de carrinho) recupera `fbp`/`fbc`/`client_id`
  pelo IP do aparelho que clicou no checkout nas 12 h anteriores; conservador, toda tentativa grava uma
  linha `platform='fdv'`, e só deve ser ligado com o IP do payload conferido como sendo o do aparelho
  (hoje, Kiwify). **Kirvano:** toda compra ia com **valor zero** para Meta, GA4, TikTok e Google Ads —
  o webhook real manda `total_price` como `"R$ 169,80"` e o parser esperava `"BRL 97.00"`: sobrava
  `"$ 169,80"` (lido como 0) e a moeda `R$`, que não é código ISO. Agora sai `169.80` em `BRL`.
  **Docs:** o teste de webhook do gateway passa a ser feito **sempre sob `shadow`**
  (o teste da Kiwify tinha virado `Purchase` real na Meta e no TikTok no dia da instalação), e a
  auditoria acha venda de teste já despachada; o `google_ads.md` cobre o OAuth do lado do operador
  (app "Em teste" = refresh token de 7 dias; quem autoriza é dono do token; o código não se repassa;
  atraso de segurança da conta Google) e o `gads:oauth` lembra de publicar o app; a retenção
  documentada passou a ser a real (7/14/90 dias, não 30); host alternativo `*.pages.dev` com beacon
  relativo → `405` entrou no onboarding e na auditoria. **Sem migração de banco**; tudo o que é novo é
  opt-in (`platforms.ga4.unattributed_purchases`, `fdv.ip_fallback`, `cookies.user`, `collect_url`).
- **1.8.0** — **Meta Pixel servido pelo próprio domínio (proxy first-party)**. O `fbevents.js`, a
  config do pixel, os plugins e o beacon `/tr` passam a ser servidos por `{dominio}/fb/*`, no mesmo
  modelo do proxy do GA4. `connect.facebook.net` e `facebook.com/tr` estão em toda lista de bloqueio,
  e para esse visitante o `fbq` ficava só o stub da fila — nenhum evento de navegador saía e o cookie
  `_fbp` (que só o `fbevents.js` cria) nunca existia, então até a CAPI do VT ia sem `fbp`. Agora o
  script carrega, o `_fbp` nasce, o evento de navegador chega deduplicado com o da CAPI pelo mesmo
  `event_id`, e a URL da Meta some do inspecionar. O Worker reescreve dentro dos scripts os literais
  que a Meta embute (`CDN_BASE_URL`, que é também o que o guard interno "Disallowed script URL"
  valida, e o endpoint do `/tr`), sem tocar em `instagram.com/tr`, na Topics API nem no Gateway pago
  da Meta. O nome `sdk.js` é de propósito: a EasyPrivacy tem regra **genérica** `/fbevents.js`, então
  `/fb/fbevents.js` seria bloqueado igual — os caminhos foram conferidos contra EasyList,
  EasyPrivacy, uBlock e AdGuard. **Opt-in** por `platforms.meta.pixel_proxy` (default `true` na
  instalação nova; ausente = tudo como antes, nenhuma route nova exigida), com o modo `"script"` como
  recuo, porque o modo completo tem um trade-off honesto: o `/tr` sai do edge da Cloudflare e a Meta
  deixa de ver o IP e os cookies de login do Facebook no evento de **navegador** do visitante sem
  bloqueador (a CAPI segue com IP real, `fbp`, `fbc`, `external_id` e dados hasheados) — o critério
  de avaliação é o Event Match Quality antes e depois. Instalação antiga que ligar a flag sem a route
  `/fb/*` **não perde o pixel**: o `web.js` detecta o `sdk.js` falhando (404, ou HTML 200 num host
  SaaS) e carrega `connect.facebook.net` direto uma vez, com `console.warn` dizendo o que falta. A base
  do proxy é absoluta (o host de onde o `web.js` foi servido), então funciona igual na raiz e em
  `track.{dominio}`. Sem migração de banco. Verificado com o `fbevents.js` real (v2.9.393): nenhum
  `https://connect.facebook.net/` sobra no script servido, e o guard interno passa.
- **1.7.0** — **SaaS por assinatura: recorrência, classificação da cobrança e recuperação de
  identidade**. O VT deixa de tratar toda cobrança aprovada como uma venda nova. Com
  `subscription_tracking` ligado, cada cobrança é classificada em **aquisição**, **renovação** ou
  **reativação** — e cada uma vai para o evento e a ação de conversão certos: a Meta recebe
  `Subscribe` / `SubscriptionRenewal` / `SubscriptionReactivation` (com `billing_type` em
  `custom_data` e `subscription_id` em `user_data`), e o Google Ads roteia as recorrentes para uma
  **segunda ação de conversão**, porque a de aquisição precisa ser contagem "Uma" — e com ela a
  renovação no mesmo clique seria descartada, ou contaria como aquisição num clique novo. Sem a 2ª
  ação, a recorrente é **barrada com log legível**; nunca sobe na ação errada. Na aquisição,
  `subscription_events` aceita **array** (`["Purchase","Subscribe"]`), porque a Meta não deduplica
  nomes diferentes: quem já otimiza por compra mantém o aprendizado e ganha o evento novo para teste.
  O contrato dos parsers ganhou `subscription_id`, `charges_paid_hint` e `plan`, com a distinção que
  custa a recorrência inteira — **`order_id` é a FATURA (muda a cada cobrança), `subscription_id` é o
  CONTRATO (estável)**; usar o estável como número do pedido faz **toda renovação cair no dedup e
  nunca chegar às plataformas**, que era exatamente o caso da Ticto. Mapeados com payload real em
  **Ticto e Hotmart** (os outros 10 gateways têm um protocolo de descoberta na `/new-gateway` —
  nunca inferir caminhos). Cancelamento passa a ser processado (`CANCEL_EVENTS`) sem despachar nada:
  é o insumo da reativação. **Projeto misto** (parte assinatura, parte compra única no mesmo painel)
  é resolvido por listas de `product_id`, e um ID não classificado vira **linha de aviso acionável no
  D1**, nunca uma decisão no escuro. Como a renovação é 100% server-side, a identidade é recuperada
  por **merge por e-mail** no `user_store` — alimentado pelo beacon interno `identify`, que dispara
  quando um e-mail válido é digitado (num app logado, o login faz isso todo dia). Medido em produção:
  2 de 90 webhooks traziam o indexador, e ainda assim 21 conversões saíram com identidade — 19
  recuperadas por e-mail. `triggers.lead` **deixa de ser decorativo**: `type: "disabled"` passa a ser
  lido de verdade, e `routes` roteia o submit por slug com `confirm_success`, que só dispara o evento
  quando o back-end responde 2xx (num app, login e cadastro têm o mesmo submit — antes tudo virava
  "Lead"; medido: 210/dia misturado → `lead` 27 + `login` 167). Novos: playbook `saas.md`,
  reference `saas-hospedado.md` com a **regra bloqueante de nunca proxiar host servido por plataforma
  SaaS** (ligar a nuvem laranja no apex **derrubou um site em produção**, e a validação imediata
  passou — falso verde), `npm run subs:import` para semear a base legada e a seção **2.11** na
  auditoria, com o **teto de atribuição** que evita o falso alarme (a atribuição da renovação começa
  baixa por cobertura, não por defeito). Migrações: **005** (índice de e-mail, para todos) e **004**
  (tabela `subscriptions`, **só** para projeto de assinatura — em compra única ela ficaria órfã, por
  isso está fora do `schema.sql`). **Validado em produção**: em 6 dias, 9 aquisições, 77 renovações e
  3 reativações classificadas e roteadas corretamente, zero falha de envio.
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

## Como atualizar uma instalação existente

Quem já tem o VT rodando **não precisa reinstalar nada**. O procedimento completo — descobrir a
versão no ar, o que muda entre ela e a atual, migrações, deploy, verificação e rollback — está em
[`.claude/playbooks/atualizar.md`](.claude/playbooks/atualizar.md). Peça ao assistente *"quero
atualizar meu VT"* que ele conduz.

Três garantias de projeto, para a atualização nunca derrubar produção:

1. **Toda migração é aditiva** (`ADD COLUMN`) — nenhuma apaga dado ou altera coluna existente.
   Voltar o código para a versão anterior é seguro: as colunas novas apenas ficam sem uso.
2. **Esquecer a migração não quebra o tracking.** O código detecta a coluna ausente, segue gravando
   normalmente e escreve um aviso no log dizendo o comando exato que falta. Perde-se só o recurso
   novo, nunca o que já funcionava.
3. **Config novo é sempre opt-in.** Campo que você não preencher mantém o comportamento anterior.

A ordem importa: **migração do banco antes do deploy do código**. O playbook cobre o porquê.

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
│       ├── routes/             # Endpoints auxiliares (serve-webjs, debug, logs, ga4-proxy, meta-proxy)
│       ├── shared/             # Utilitários (config, hash, helpers, cleanup, logger, db-write)
│       └── store/              # Persistência de sessão/usuário (user-store, fdv)
│
├── .claude/                    # Documentação operacional e skills do assistente
│   ├── workflow.md             # ★ Maestro: ciclo de onboarding, roteamento e regras
│   ├── skills/                 # Skills user-invocáveis descobertas (new-gateway/, add-platform/, audit-tracking/)
│   ├── playbooks/              # Playbooks lidos por caminho pelo workflow (overview, infra, plataformas)
│   ├── references/             # Referências técnicas (formato de config, qualificação de lead, site em plataforma SaaS, etc.)
│   └── memory_template.md      # Template do tracking_memory.md (estado entre sessões)
│
├── scripts/                    # Build (sync-webtemplate.mjs) + google-ads-oauth.mjs + import-subscriptions.mjs
├── migrations/                 # Migrações de schema do D1 (004 = tabela de assinaturas, opt-in)
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
