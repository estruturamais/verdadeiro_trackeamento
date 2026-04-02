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

## Dual-pixel Meta

- ativo: sim | nao
- purchase_trigger_event: lead (default)

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

<!-- Gerado pela skill tracking_base no Step 3b.
     Inserir como SITE_CONFIG no [vars] do wrangler.toml (JSON em uma linha).
     NAO incluir access_tokens, api_secret nem log_bearer_token aqui — sao secrets do wrangler.
     Incluir apenas plataformas confirmadas. Omitir secoes nao aplicaveis.
-->

```json
{
  "site_id": "{site_id}",
  "debug": false,
  "platforms": {
    "meta": {
      "pixel_id": "{pixel_id}",
      "pixel_id_purchase": "{pixel_id_purchase ou omitir se nao dual-pixel}",
      "purchase_trigger_event": "lead"
    },
    "tiktok": {
      "pixel_id": "{pixel_id}"
    },
    "ga4": {
      "measurement_id": "{G-XXXXXXXXXX}"
    },
    "google_ads": {
      "conversion_id": "{AW-XXXXXXXXXX}",
      "channel": "web",
      "conversion_label_contact": "{label}",
      "conversion_label_lead": "{label}",
      "conversion_label_purchase": "{label}"
    }
  },
  "gateways": ["{gateway_1}", "{gateway_2}"],
  "gateways_config": {
    "hotmart": {
      "domains": ["hotmart.com", "hotmart.com.br", "pay.hotmart.com", "go.hotmart.com"],
      "caminho": "sck",
      "indexador": "xcod",
      "user_params": { "email": "email", "phone": "phonenumber", "name": "name" }
    },
    "kiwify": {
      "domains": ["kiwify.com", "kiwify.com.br", "pay.kiwify.com.br"],
      "caminho": "caminho",
      "indexador": "sck"
    },
    "ticto": {
      "domains": ["ticto.com.br", "ticto.app", "checkout.ticto.app", "checkout.ticto.com.br", "payment.ticto.app"],
      "caminho": "caminho",
      "indexador": "sck"
    },
    "kirvano": {
      "domains": ["kirvano.com", "pay.kirvano.com"],
      "caminho": "caminho",
      "indexador": "src"
    },
    "eduzz": {
      "domains": ["eduzz.com", "eduzz.com.br", "chk.eduzz.com", "sun.eduzz.com"],
      "caminho": "caminho",
      "indexador": "utm_medium"
    },
    "lastlink": {
      "domains": ["lastlink.com", "lastlink.com.br", "pay.lastlink.com"],
      "caminho": "caminho",
      "indexador": "utm_id"
    },
    "perfectpay": {
      "domains": ["perfectpay.com.br", "checkout.perfectpay.com.br"],
      "caminho": "caminho",
      "indexador": "utm_perfect"
    },
    "pagtrust": {
      "domains": ["pagtrust.com", "pagtrust.com.br", "checkout.pagtrust.com.br"],
      "caminho": "sck",
      "indexador": "sck"
    },
    "payt": {
      "domains": ["payt.com.br", "checkout.payt.com.br"],
      "caminho": "caminho",
      "indexador": "src"
    }
  },
  "triggers": {
    "lead": {
      "type": "form_submit",
      "selectors": { "elementor": true, "cf7": true, "generic": true }
    },
    "contact": {
      "type": "link_click",
      "match": "wa.me|api.whatsapp"
    },
    "initiate_checkout": {
      "type": "link_click",
      "match": "pay|checkout"
    }
  },
  "custom_data": {
    "page_type": {
      "conditions": [
        { "if": "document.title.includes('vendas')", "value": "vendas" }
      ],
      "fallback": "outras"
    }
  },
  "cookies": {
    "user": "marca_user",
    "email": "marca_email",
    "phone": "marca_phone",
    "name": "marca_name"
  },
  "geolocation": {
    "provider": "ipgeolocation",
    "api_key": "{CONFIGURADO (SECRETO)}",
    "fallback_provider": "visitorapi",
    "fallback_api_key": "{CONFIGURADO (SECRETO)}"
  },
  "logging": {
    "enabled": true,
    "retention_days": 30,
    "log_bearer_token": "{CONFIGURADO (SECRETO)}"
  }
}
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
