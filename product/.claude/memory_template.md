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
- pixel_id_purchase: {valor ou nao aplicavel}
- access_token_purchase: CONFIGURADO (SECRETO)

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

## Status do workflow

- [ ] Step 0: infraestrutura Cloudflare configurada
- [ ] Step 1: plataformas confirmadas
- [ ] Step 2: site analisado e eventos mapeados
- [ ] Step 3: credenciais coletadas
- [ ] Step 3b: config inserido no wrangler.toml e secrets configurados
- [ ] Step 4: validacao concluida
- [ ] Step 5: script instalado no site
- [ ] Step 6: entrega concluida
