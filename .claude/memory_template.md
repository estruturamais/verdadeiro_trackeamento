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
- tipo_site: tradicional | spa | misto   <!-- IZZO-14: spa/misto quando ha funil de quiz cujo botao de compra copia window.location.search p/ o checkout (Next.js/React/XQuiz/Cakto). 'misto' = tradicional + quiz em slugs/subdominios especificos. Decidido pela pergunta A/B/C do Step 2. -->
- spa_mode_locations:                     <!-- so quando ha funil de quiz: cada slug/subdominio de quiz + o gateway que ele usa (pre-fixa o indexador do marca_user). Vira spa_mode.locations no SITE_CONFIG. -->
  - match: {/quiz  ou  quiz.seusite.com}
    gateways: [{lastlink}]
- disable_url_rewrite: nao           <!-- IZZO-10: sim so se a reescrita de URL conflitar com modais/router/PWA do site (cai p/ modo "so links externos"). -->
- utmify_detectada: nao | sim        <!-- IZZO-8: se cdn.utmify.com.br presente no <head>; ver references/utmify-compat.md p/ ordem de instalacao. -->
- urls_validacao_e2e:                <!-- IZZO-9: preenchido no Step 5 (validacao do caminho do marca_user). -->
  - inicial: {URL completa com params, apos load}
  - checkout: {URL completa com params, apos clicar em comprar}

---

## Plataformas confirmadas

- [ ] Meta Ads
- [ ] TikTok Ads
- [ ] GA4
- [ ] Google Ads

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
- channel: web | server
- conversion_label_contact: {valor}
- conversion_label_lead: {valor}
- conversion_label_purchase: {valor}

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
