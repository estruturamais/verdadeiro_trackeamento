# Tracking Memory — {site_id}

<!-- INSTRUCOES DE USO (remover este bloco ao copiar para um cliente)
1. Ao iniciar, verificar se ja existe `tracking_memory.md` — se sim, carregar e continuar de onde parou
2. Ao receber qualquer dado (mesmo fora de ordem), gravar imediatamente neste arquivo
3. Ao iniciar cada step, verificar esta memoria antes de perguntar — pedir apenas o que falta
4. Valores de secrets: gravar apenas "CONFIGURADO (SECRETO)" — nunca o valor real
5. Ao concluir cada step, marcar como concluido na secao "Status do workflow"
6. Config JSON: usar SITE_CONFIG no [vars] do wrangler.toml — NAO existe tabela site_config no D1
-->

---

## Infraestrutura

- cloudflare_account_id: {valor}
- worker_name: {valor}
- d1_database_id: {valor}
- dominio: {valor}
- infra_status: pendente | configurada | deployada

---

## Cliente

- site_id: {valor}
- dominio: {valor}
- cms_detectado: {valor}
- modelo: infoproduto | negocio_local
- modelo_receita: compra_unica | assinatura | misto   <!-- Step 1.1. assinatura/misto => carregar playbooks/saas.md, rodar migrations/004 e ligar subscription_tracking. compra_unica => NAO criar a tabela subscriptions (ficaria orfa). -->
- plataforma_hospedagem: {valor}     <!-- Lovable | Vercel | Netlify | Framer | Webflow | WordPress | outro. Se for plataforma SaaS: NENHUM host dela pode ficar laranja; tracking so em track.{dominio}. Ver references/saas-hospedado.md. -->
- assinatura:                        <!-- so quando modelo_receita = assinatura | misto -->
  - gateways_com_recorrencia: [{ticto}]   <!-- so ticto e hotmart tem a recorrencia mapeada; outros exigem /new-gateway Passo 1b com payload real -->
  - product_ids_saas: [{id}]              <!-- projeto misto: os que SAO assinatura -->
  - product_ids_avulso: [{id}]            <!-- projeto misto: os de compra unica -->
  - evento_aquisicao: Subscribe | [Purchase, Subscribe]   <!-- decidido COM o cliente (saas.md Passo 1.2) -->
  - conversion_action_id_renewal: {id}    <!-- 2a acao do Google Ads (UPLOAD_CLICKS, secundaria, "Todas") -->
  - conversoes_personalizadas_meta: nao | sim  <!-- SubscriptionRenewal/Reactivation sao eventos CUSTOM; o cliente precisa cria-las no Gerenciador -->
  - base_legada_semeada: nao | sim ({data})    <!-- CSV incluindo os CANCELADOS; npm run subs:import -->
  - migration_004_aplicada: nao | sim
- tipo_site: tradicional | spa | misto   <!-- spa/misto quando ha funil de quiz cujo botao de compra copia window.location.search p/ o checkout (Next.js/React/XQuiz/InLead). 'misto' = tradicional + quiz em slugs/subdominios especificos. Decidido pela pergunta A/B/C do Step 2. -->
- spa_mode_locations:                     <!-- so quando ha funil de quiz: cada slug/subdominio de quiz + o gateway que ele usa (pre-fixa o indexador do marca_user). Vira spa_mode.locations no SITE_CONFIG. -->
  - match: {/quiz  ou  quiz.seusite.com}
    gateways: [{lastlink}]
- disable_url_rewrite: nao           <!-- sim so se a reescrita de URL conflitar com modais/router/PWA do site (cai p/ modo "so links externos"). -->
- utmify_detectada: nao | sim        <!-- se cdn.utmify.com.br presente no <head>; ver references/utmify-compat.md p/ ordem de instalacao. -->
- urls_validacao_e2e:                <!-- preenchido no Step 5 (validacao do caminho do marca_user). -->
  - inicial: {URL completa com params, apos load}
  - checkout: {URL completa com params, apos clicar em comprar}

---

## Plataformas confirmadas

- [ ] Meta Ads
- [ ] TikTok Ads
- [ ] GA4
- [ ] Google Ads
- [ ] Planilha (Sheets)

---

## Pixels espelho Meta

- ativo: sim | nao
- pixel_ids_mirror: []

---

## Eventos confirmados

- {evento}: {descricao do trigger}

---

## Credenciais coletadas

### Meta Ads

- pixel_id: {valor}
- access_token: CONFIGURADO (SECRETO)
- pixel_ids_mirror: {lista de pixels espelho ou nao aplicavel}

### TikTok Ads

- pixel_id: {valor}
- access_token: CONFIGURADO (SECRETO)

### GA4

- measurement_id: {valor}
- api_secret: CONFIGURADO (SECRETO)

### Google Ads

- conversion_id: {valor}
- channel: web (default — eventos de navegador) | server
- customer_id: {10 digitos, sem hifens}
- login_customer_id: {ID da MCC, se houver}
- conversion_action_id_purchase: {id NUMERICO da acao de importacao — o `ctId=` da URL}
- upload_api: data_manager (default) | conversion_upload (so conta ja allowlisted)
- conversion_label_page_view: {valor ou vazio}
- conversion_label_contact: {valor}
- conversion_label_lead: {valor}
- conversion_label_initiate_checkout: {valor ou vazio}
- GOOGLE_ADS_CLIENT_ID: CONFIGURADO (SECRETO) | nao usa purchase server-side
- GOOGLE_ADS_CLIENT_SECRET: CONFIGURADO (SECRETO) | nao usa purchase server-side
- GOOGLE_ADS_REFRESH_TOKEN: CONFIGURADO (SECRETO) | nao usa purchase server-side
- Data Manager API habilitada no Cloud: sim | nao
- Marcacao automatica (auto-tagging) ligada: sim | nao | nao verificado

> Rotulo vazio = evento nao vira conversao (opt-in). `conversion_label_purchase` NAO se aplica ao
> caminho server-side: acao de importacao nao tem rotulo, so id numerico.

### Planilha (Sheets)

- id_script: {valor}
- planilhar: leads | vendas | os_dois   <!-- resposta do Passo 1 do planilha.md -->
- aba_leads: users                       <!-- vira sheets.sheet no SITE_CONFIG -->
- aba_vendas: transactions               <!-- vira sheets.purchase.sheet (opt-in) -->
- versao_gas: v3 | v1_v2_migrar          <!-- teste 1b do planilha.md (resposta com campo `sheet` = v3) -->

---

## Config JSON gerado

<!-- Estrutura: seguir config.example.json. Gravar aqui o JSON minificado
     efetivamente inserido no SITE_CONFIG do wrangler.toml.
     NAO incluir access_tokens de Meta, api_secret de GA4 — sao wrangler secrets.
     TikTok access_token e excecao: incluir no JSON (o codigo nao le de env). -->

```json
{cole aqui o JSON gerado no Step 3b}
```

---

## analistA+ (consulta de dados)

<!-- Opt-in pos-Step 6. A captura de UTM ja roda por padrao desde o deploy;
     estes campos definem a LEITURA (convencao) e a RETENCAO. Fonte da verdade = SITE_CONFIG. -->

- ativo: sim | nao
- convencao_utm: padrao | custom
  - criativo: utm_content
  - conjunto: utm_term
  - sinal_pago: utm_medium=paid
  - (se custom: descrever qual campo carrega o criativo e como marca trafego pago)
- retencao_mode: auto_clean | keep_all
- retencao_when_full: recycle_oldest | halt_writes  <!-- so quando keep_all -->

---

## Status do workflow

- [ ] Step 0: infraestrutura Cloudflare configurada
- [ ] Step 1: plataformas confirmadas
- [ ] Step 2: site analisado e eventos mapeados
- [ ] Step 3: credenciais coletadas
- [ ] Step 3b: config inserido no wrangler.toml e secrets configurados
- [ ] Step 4: validacao concluida
- [ ] Step 5: script instalado no site
- [ ] Step 6: entrega concluida
