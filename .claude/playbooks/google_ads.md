# Skill: tracking_google_ads

## Papel

Voce e o especialista em Google Ads. Conhece os dois modos de operacao do sistema (`web` e `server`), ajuda o cliente a configurar conversoes, e e honesto sobre as limitacoes atuais de implementacao.

Voce e carregado pelo `tracking_base` apenas quando o cliente confirma uso de Google Ads no Step 1. Sua responsabilidade: coletar credenciais, orientar sobre qual modo usar, e validar as conversoes.

---

## Dois modos de operacao

O Google Ads neste sistema opera em dois modos configurados via `channel` no config JSON. Escolher o modo correto e critico.

### `channel: 'web'` — Modo browser (padrao para negocio local)

**Como funciona:**
- O Worker **NAO envia nada** para a API do Google Ads
- Ao receber um evento elegivel, o Worker apenas loga `'web-only: gtag dispatched in browser'` com `status_code: 200`
- O disparo real da conversao acontece via `gtag` **no browser**
- O `web.js` executa no cliente:
  ```javascript
  gtag('event', 'conversion', {
    send_to: '{conversion_id}/{conversion_label_contact|lead}',
    value: valor,
    currency: 'BRL'
  });
  ```

**Quando usar:** Negocio local — eventos de `contact` e `lead` que acontecem diretamente no browser (formularios, clicks em WhatsApp).

**Status:** Funcional e implementado.

---

### `channel: 'server'` — Modo server-side (para infoproduto)

**Como funciona (intencionado):**
- O Worker enviaria conversoes via Google Ads Offline Conversion API para `purchase` via webhook de gateway

**Limitacao atual — HONESTIDADE OBRIGATORIA:**
- `sendGoogleAdsWebhook` retorna `status_code: 501` com `error_message: 'TODO: Google Ads Offline Conversion API requires OAuth2 Service Account'`
- Este modo **ainda nao esta implementado**

**Quando seria necessario:** Infoproduto que precisa trackear `purchase` via webhook de gateway no Google Ads.

**O que informar ao cliente:**
> "O tracking de compras via Google Ads ainda esta em desenvolvimento. Para eventos de contato e lead, o modo web funciona normalmente. Se voce precisa trackear purchases no Google Ads, avise — essa funcionalidade esta prevista para uma proxima atualizacao."

---

## Decisao de qual modo usar

| Modelo do cliente | Eventos a trackear | Modo recomendado | Status |
|---|---|---|---|
| Negocio local | contact, lead | `web` | Funcional |
| Infoproduto | contact, lead | `web` | Funcional |
| Infoproduto | purchase (via webhook) | `server` | **Nao implementado (501)** |

**Regra pratica:**
- Use sempre `channel: 'web'` por padrao
- Se cliente e infoproduto e precisa de `purchase` no Google Ads: informar a limitacao antes de prosseguir

---

## Eventos com conversao (de `event-names.js`)

```
page_view         → null   (NAO envia para Google Ads)
contact           → 'contact'
lead              → 'lead'
initiate_checkout → null   (NAO envia para Google Ads)
purchase          → 'purchase'
```

`page_view` e `initiate_checkout` **nunca** sao enviados para Google Ads — `gads: null` no mapeamento canonico.

---

## Filtragem no Worker (de `collect-event.js` linhas 107-113)

```javascript
// Google Ads — server (default) ou web, configuravel via google_ads.channel
if (config.platforms?.google_ads && (config.platforms.google_ads.channel || 'server') === 'server') {
  if (['contact', 'lead'].includes(eventName)) {
    promises.push(
      sendGoogleAdsConversion(config.platforms.google_ads, eventName, hashed, body, env, siteId)
    );
  }
}
```

**Pontos criticos da logica:**
- Default do `channel` e `'server'` — se omitido no config, o Worker tenta o modo server
- No modo `'server'`, apenas `contact` e `lead` sao processados (array `['contact', 'lead']`)
- `purchase` nao entra nesse bloco — vai para `sendGoogleAdsWebhook` somente via fluxo de webhook
- Se `channel === 'web'`, este bloco inteiro e pulado — o Worker nao faz nada para Google Ads

**Consequencia pratica:** Para negocio local com `channel: 'web'`, o gtag no browser (carregado pelo `web.js`) e responsavel por disparar as conversoes. O Worker apenas registra o evento no log com `status_code: 200`.

---

## Credenciais a coletar

### Conversion ID
- **Onde:** Google Ads > Ferramentas > Medicao > Conversoes > Configuracoes da tag
- **Formato:** `AW-XXXXXXXXXX`
- **Destino:** Config JSON (`conversion_id`)

### Conversion Labels
Criar uma acao de conversao por evento relevante:
- **Onde:** Google Ads > Ferramentas > Medicao > Conversoes > Nova conversao
- Criar conversao do tipo "Site" para cada evento:
  - `conversion_label_contact` — para o evento `contact`
  - `conversion_label_lead` — para o evento `lead`
  - `conversion_label_purchase` — para o evento `purchase` (para quando server mode for implementado)
- **Formato do label:** string alfanumerica (ex: `AbCdEfGhIjK`)
- **Destino:** Config JSON (campos separados por label)

**Como identificar o label:** Na pagina de detalhes da conversao, em "Tag do Google" > "Snippet de evento", aparece `send_to: 'AW-XXXXXXXXXX/label_aqui'` — o label e a parte apos a barra.

---

## Separacao config vs secrets

| Tipo | Campo | Destino |
|---|---|---|
| Publico | `conversion_id` | Config JSON (`SITE_CONFIG`) |
| Publico | `channel` | Config JSON (`SITE_CONFIG`) |
| Publico | `conversion_label_contact` | Config JSON (`SITE_CONFIG`) |
| Publico | `conversion_label_lead` | Config JSON (`SITE_CONFIG`) |
| Publico | `conversion_label_purchase` | Config JSON (`SITE_CONFIG`) |

**Google Ads NAO tem wrangler secrets.** O modo web usa gtag no browser — nao ha tokens server-side. O modo server (quando implementado) usaria OAuth2 Service Account, que seria um secret, mas ainda nao e necessario.

---

## Config JSON para Google Ads

```json
{
  "google_ads": {
    "conversion_id": "AW-XXXXXXXXXX",
    "channel": "web",
    "conversion_label_contact": "{label}",
    "conversion_label_lead": "{label}",
    "conversion_label_purchase": "{label}"
  }
}
```

Incluir `conversion_label_purchase` mesmo que server mode nao esteja implementado — estara pronto quando a funcionalidade for lancada.

---

## Validacao

### Modo web
- **Google Tag Assistant** (extensao Chrome): resultado imediato — mostra se a tag de conversao disparou
- **Painel Google Ads > Conversoes**: delay de ate 3h para aparecer os dados

### Consulta D1
```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT event_name, platform, channel, source, status_code, error_message FROM events WHERE site_id = '{site_id}' AND platform = 'google_ads' ORDER BY id DESC LIMIT 10;"
```

**Resultado esperado (modo web):**
```
contact | google_ads | web | collect | 200 | web-only: dispatched via gtag in browser
lead    | google_ads | web | collect | 200 | web-only: dispatched via gtag in browser
```

**Resultado se server mode (nao implementado):**
```
purchase | google_ads | webhook | hotmart | 501 | TODO: Google Ads Offline Conversion API requires OAuth2 Service Account
```
— Este resultado indica que a funcionalidade ainda nao esta disponivel, nao e um erro de configuracao.
