# Referencia: convencao de UTM + extracao por gateway

Fonte unica sobre **o que cada UTM significa** no VT (a convencao recomendada) e **onde a UTM mora
no payload de cada gateway** (a extracao). Lida por caminho pela skill `/analistamais` (para
interpretar os dados), pela skill `new-gateway` (ao mapear um gateway novo) e pela pergunta opt-in do
`workflow.md` (ao configurar o **analistA+**). Nao duplicar este conteudo em outros docs — apontar
para ca.

> **Nomenclatura:** o produto e o **analistA+** (display: `analistA+`/`AnalistA+`); o slug/slash
> command e `/analistamais`. Nunca "Analista a Mais".

Relacionado: o identificador do visitante e a `[[marca-user]]` — referencia `marca-user.md`. As UTMs
descrevem **a origem da visita/venda**; o `marca_user` descreve **quem** e cruza web ↔ webhook.

---

## Parte 1 — A convencao recomendada (o padrao "a prova de falha")

O VT recomenda um padrao de UTM **baseado na documentacao das plataformas de anuncios**, nao em
achismo. O cliente configura uma vez e o `/analistamais` consegue ler os dados sem ambiguidade. O
material completo (com explicacao de variaveis dinamicas e o criador de links) e disponibilizado na
**area de membros** (planilha "A+ Data Base — UTM padrao").

### A regra de ouro do padrao

| UTM | Papel | Vale para |
|---|---|---|
| `utm_source` | **rede/canal** de origem | `fb`, `ig`, `an`, `msg`, `th`, `ytv`, `g`, `x`, `whatsapp`, `activecampaign`… |
| `utm_medium` | **`paid` ou `organic`** — o classificador de trafego | `paid` \| `organic` |
| `utm_campaign` | **nome da campanha** | `CBO_CAPTACAO_EVENTO` |
| `utm_term` | **nome do conjunto/adset** (ou publico/posicionamento no organico) | `{{adset.name}}`, `ABERTO_ADVANTAGE` |
| `utm_content` | **nome do anuncio/criativo** | `{{ad.name}}`, `AD001` |

> **Invariante da analise:** o trafego pago e identificado por **`utm_medium = 'paid'`** — nunca por
> adivinhacao a partir dos valores de `utm_source`. "Criativo" e sempre **`utm_content`**; "conjunto"
> e sempre **`utm_term`**.

### Variaveis dinamicas por plataforma (referencia de setup)

- **Meta Ads** (`utm_source`: `fb, ig, an, msg, th`): `utm_campaign={{campaign.name}}`,
  `utm_term={{adset.name}}`, `utm_content={{ad.name}}`, `utm_medium=paid`.
  Docs: facebook.com/business/help/2360940870872492 e /1016122818401732.
- **Google Ads**: `utm_campaign={_campaign}`, `utm_term={_midia}`, `utm_content={_conteudo}`,
  `utm_medium=paid`. O `utm_source` usa o codigo do tipo de trafego (`{_origem}`):
  `g`=Pesquisa Google, `s`=parceiros de pesquisa, `d`=Rede de Display, `ytv`=YouTube,
  `vp`=parceiros de video, `gtv`=Google TV, `x`=Performance Max, `e`=apps para engajamento (ACe).
  Doc: support.google.com/google-ads/answer/6305348 (URL final / modelo de acompanhamento).
- **WhatsApp** (`utm_source=whatsapp`): `utm_medium=paid` (API) ou `organic` (humano);
  `utm_term`=publico/grupo do disparo; `utm_content`=fluxo/mensagem.
- **E-mail** (`utm_source`=plataforma: `activecampaign`, `datacrazy`, `leadlovers`):
  `utm_medium=paid` (API) ou `organic`; `utm_term`=lista; `utm_content`=qual e-mail.
- **YouTube organico** (`utm_source=ytv`, `utm_medium=organic`): `utm_term`=posicionamento
  (`qrcode, chat, descricao, comentario, bio`); `utm_content`=qual video.
- **Instagram organico** (`utm_source=ig`, `utm_medium=organic`): `utm_term`=`manychat, bio, stories`;
  `utm_content`=postagem/criativo.

---

## Parte 2 — Como a convencao e armazenada

O **SITE_CONFIG e a fonte da verdade** (sobrevive a perda de arquivos locais; o `tracking_memory` e
cache derivado). A convencao vai no bloco `utm_convention`, com o **default abaixo** — confirmado
e/ou sobrescrito pelo cliente na pergunta opt-in do `workflow.md` (quem nao segue o padrao informa o
proprio modelo).

```json
"utm_convention": {
  "creative": "utm_content",
  "adset": "utm_term",
  "campaign": "utm_campaign",
  "source": "utm_source",
  "paid_signal": { "field": "utm_medium", "equals": "paid" },
  "custom": false
}
```

- `creative` / `adset` / `campaign` / `source`: qual coluna `utm_*` carrega cada papel.
- `paid_signal`: como distinguir pago de organico **na leitura** (default: `utm_medium == 'paid'`).
- `custom`: `true` quando o cliente nao segue o padrao recomendado (o `/analistamais` avisa que a
  leitura segue a convencao informada por ele).

> **v0 — convencao unificada pago/organico:** o mesmo mapeamento serve para os dois (o que muda e o
> valor de `utm_medium`: `paid` vs `organic`, e a leitura semantica de `utm_term`/`utm_content` —
> conjunto/anuncio no pago; posicionamento/peca no organico). Uma versao futura pode separar a
> convencao por canal se necessario; para a v0 esta forma unica basta.

> **Principio duro (ELT, nao ET):** o banco guarda a UTM **crua, intocada**. Nada de normalizar
> `paid/organic` nem reescrever valores no momento da escrita. Toda classificacao acontece **na
> leitura**, dentro do `/analistamais`, conforme esta convencao.

---

## Parte 3 — Extracao por gateway (planta tecnica)

As 5 colunas `utm_*` do `events` (lado web) vem do `web.js` ja padronizado. As 5 colunas `utm_*` do
`webhook_raw` (lado venda, **last-click**) vem do **parser dedicado de cada gateway** — cada um
formata diferente. Esta e a planta confirmada a partir de payloads reais:

| Gateway | Base das UTMs | Mapeamento | Cobertura |
|---|---|---|---|
| **Hotmart** | `data.purchase.origin.sck` | **split `\|`** na ordem `[source, medium, campaign, term, content]` | 5/5 |
| **PagTrust** | = Hotmart (mesmo formato) | idem | 5/5 |
| **Kiwify** | `TrackingParameters.*` | `utm_source/medium/campaign/content/term` diretos | 5/5 |
| **Kirvano** | `data.utm.*` | `utm_source/medium/campaign/term/content` diretos | 5/5 |
| **Lastlink** | `Data.Utm.*` (**PascalCase**) | `UtmSource/UtmMedium/UtmCampaign/UtmTerm/UtmContent` | 5/5 |
| **Hubla** | `event.invoice.paymentSession.utm.*` | `source/medium/campaign/content/term` diretos | 5/5 |
| **Green** | `saleMetas[]` (pares `{meta_key, meta_value}`) | iterar e casar `meta_key == 'utm_*'` | 5/5 |
| **Ticto** | `tracking.*` (espelho em `query_params.*`) | `utm_source/medium/campaign/term/content` diretos | 5/5 |
| **Payt** | `link.sources.*` | `utm_source/medium/campaign/term/content` diretos | 5/5 |
| **Eduzz** | `data.utm.*` | `source/medium/campaign/content` — **`utm_term` = NULL** (sacrificado para `marca_user`) | 4/5 |
| **Tutory** | `metadados.dados_visitante` (string JSON) → `referer` (URL) → `searchParams` | `searchParams.get('utm_*')` das 5 | 5/5 (quando presentes) |
| **PerfectPay** | — | **pendente** — sem payload de amostra; completar via `new-gateway` | — |

### Notas de extracao

- **Hotmart / PagTrust:** `sck` e uma string unica `source|medium|campaign|term|content`. Fazer
  `split('|')` e mapear por posicao; se vierem menos de 5 segmentos, as faltantes ficam vazias. O
  `marca_user` vem de `origin.xcod` (campo separado), **nao** do `sck`.
- **Eduzz:** o padrao do VT injeta o `marca_user` em `utm.term`; por isso a coluna `utm_term` fica
  **sempre vazia** para Eduzz (limitacao estrutural, NULL honesto).
- **Tutory:** sem parametro de rastreamento dedicado — a extracao desembrulha
  `metadados.dados_visitante` (string JSON), pega `referer` e le cada `utm_*` via `URL.searchParams`.
  O `marca_user` vem do mesmo `referer`.
- **Lastlink:** chaves em PascalCase (`UtmSource`…). O `marca_user` usa `Data.Utm.UtmId`.
- **Sufixo `|id` (UTMify):** alguns valores chegam com o ID numerico da Meta colado
  (ex.: `utm_content = "AD8.3|120246003414360049"`). Isso vem do **script da UTMify, nao do VT** —
  **gravar cru**; o `/analistamais` separa rotulo↔id apenas **na leitura** para uma resposta limpa.

### Limitacoes conhecidas (o `/analistamais` deve avisar, nao mascarar)

- **Eduzz:** sem `utm_term` (conjunto/adset).
- **Tutory:** so traz as UTMs que estiverem na URL do `referer`.
- **PerfectPay:** extracao de UTM pendente ate haver um webhook real.

---

## Onde isso vive no codigo (referencia — pode mudar de lugar)

- Captura web (5 colunas `utm_*` em `events`): insert do beacon em `src/worker/collect/event.js`
  (linha `platform='collect'`), via `body.utm_data`.
- Captura venda (5 colunas `utm_*` + `marca_user` + `value` em `webhook_raw`): UPDATE em
  `src/worker/collect/webhook.js` (chave `id = rawId`), alimentado pelo parser.
- Extracao por gateway: `src/worker/gateways/{gateway}.js` (campos `utm_*` no objeto retornado).
- Convencao default e exemplo de override: `config.example.json` (`utm_convention`).
- Leitura/classificacao pago↔organico: skill `.claude/skills/analistamais/SKILL.md`.
