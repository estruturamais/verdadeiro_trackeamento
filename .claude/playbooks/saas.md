# Skill: tracking_saas — SaaS por assinatura e recorrência

## Papel

Você é o especialista em negócios por **assinatura**. Conduz a implantação do VT em projetos onde a
receita é recorrente — puros (todo produto é assinatura) ou **mistos** (parte assinatura, parte
compra avulsa no mesmo painel do gateway).

Esta skill é carregada quando a resposta do cliente no Step 1 indicar recorrência. **Não** é
carregada em infoproduto de compra única — lá nada muda e este playbook não deve nem ser lido.

---

## Por que este playbook existe

O VT foi desenhado para **compra única**: todo webhook aprovado vira `Purchase`. Num negócio por
assinatura isso quebra de três formas ao mesmo tempo:

1. **Toda renovação vira "venda nova".** O CAC do relatório despenca, e o Smart Bidding aprende que
   qualquer clique gera cliente novo. A campanha passa a ser otimizada por um número falso.
2. **Ou nenhuma renovação é contada** — quando o gateway usa o identificador da assinatura como
   número do pedido, toda cobrança seguinte cai no dedup e **nunca chega às plataformas**.
3. **A reativação fica invisível.** Quem cancelou e voltou é contado como renovação, e o win-back —
   normalmente o público de melhor retorno — não tem como ser medido nem otimizado.

Com o modo ligado, cada cobrança aprovada é classificada em **`new`** (aquisição), **`renewal`**
(renovação) ou **`reactivation`** (reativação), e cada uma vai para o evento e a ação de conversão
certos.

---

## Cobertura por gateway — leia antes de prometer qualquer coisa

| Gateway | Compra aprovada | Assinatura | Cancelamento |
|---|---|---|---|
| **Ticto** | ✅ | ✅ **validado com payload real de produção** | ✅ |
| **Hotmart** | ✅ | ✅ validado | ✅ |
| Kiwify, Kirvano, Lastlink, Eduzz, Hubla, Green, Tutory, PagTrust, Payt, PerfectPay | ✅ | ❌ **não mapeado** | ❌ |

**Nos 10 restantes o VT ainda não sabe ler a recorrência.** Não invente os caminhos: `subscription.id`,
`subscription_code`, `contract_id`, `recurrence`, `charge_number` são todos plausíveis, e um parser
que erra o caminho **falha em silêncio** — a cobrança sai como aquisição e ninguém percebe.

Se o gateway do cliente não for Ticto nem Hotmart, **rode `/new-gateway` primeiro** (seção "Protocolo
de descoberta da recorrência") e só depois volte para cá. Diga isso ao cliente com todas as letras:
*"a estrutura de assinatura está validada em produção na Ticto e na Hotmart; no seu gateway eu preciso
de três payloads reais antes de ligar, senão eu estaria adivinhando."*

---

## Passo 1 — Entender o modelo do negócio (antes de qualquer config)

Pergunte, nesta ordem, e **grave as respostas no `tracking_memory.md`**:

### 1.1 — Todo produto é assinatura, ou é um projeto misto?

> Todos os produtos que você vende nesse painel são por assinatura (cobrança recorrente), ou tem
> também produto de compra única (pagamento avulso, vitalício, ingresso, e-book)?

- **Todos assinatura** → `"subscription_tracking": { "enabled": true }` (sem listas).
- **Misto** → **peça os IDs de produto dos dois lados.** É o que permite decidir, cobrança a
  cobrança, qual estratégia usar:

> Me manda a lista de **IDs de produto** do seu gateway separada em dois grupos: (1) os que são
> **assinatura/recorrência** e (2) os que são **compra única**. O ID aparece na tela do produto no
> painel (e é o mesmo que vem no webhook). Com isso eu consigo mandar renovação como renovação e
> compra avulsa como compra, sem misturar.

Sem as listas, o VT decide pelo sinal do próprio payload (a Ticto marca `offer.is_subscription`), o
que funciona — mas **as listas mandam** quando informadas, e um ID que não estiver em nenhuma das
duas é tratado como compra única **e gera uma linha de aviso no D1**. Nada fica implícito.

### 1.2 — Que evento a aquisição deve enviar? (pergunta obrigatória)

> Quando alguém assina pela primeira vez, você quer que eu envie o evento **`Subscribe`** (o evento
> nativo de assinatura), ou você já tem campanhas rodando otimizadas para **`Purchase`** e prefere
> continuar recebendo `Purchase` também?

| Resposta do cliente | O que gravar |
|---|---|
| "pode ser só o de assinatura" / não tem campanha ativa | nada — o default já é `Subscribe` |
| **"já tenho campanha otimizando compra"** | `"subscription_events": { "new": ["Purchase", "Subscribe"] }` |

O array manda **os dois** eventos na aquisição: a Meta **não deduplica nomes diferentes** com o mesmo
`event_id`. O `Purchase` continua alimentando o aprendizado das campanhas atuais, e o `Subscribe`
fica disponível para testar sem risco.

⚠️ **Renovação e reativação nunca entram no `Purchase`**, em nenhum cenário. É exatamente isso que
mantém o CAC do relatório honesto — se a renovação entrasse, o custo por "compra" cairia sozinho e a
conta pareceria estar melhorando enquanto a aquisição real caía.

### 1.3 — Existe base de assinantes anterior ao tracking?

Se sim → **Passo 4 é obrigatório** (semeadura). Se pular, a primeira cobrança de cada assinante
antigo é classificada como **aquisição**: um pico fantasma de "clientes novos" no primeiro ciclo.

### 1.4 — O site é servido por plataforma SaaS? (Lovable/Vercel/Netlify/Framer…)

Se sim → 🛑 leia `.claude/references/saas-hospedado.md` **antes** de tocar em DNS. Ligar o proxy da
Cloudflare num host da plataforma **derruba o site**, e a validação imediata **passa mesmo assim**.

### 1.5 — O script vai rodar dentro do app logado?

Se sim → **Passo 5** (roteamento de `triggers.lead`). Sem ele, login, busca e recuperação de senha
viram "Lead".

---

## Passo 2 — Criar a tabela de assinaturas

```bash
wrangler d1 execute tracking_db --file=./migrations/004_add_subscriptions_table.sql --remote
```

> ⚠️ Esta migração é **opt-in** e **não** faz parte do `schema.sql`: num projeto de compra única a
> tabela ficaria órfã. Rode-a **apenas** quando `subscription_tracking` for ligado.

Confirme:

```bash
wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) FROM subscriptions"
```

**Se esquecer este passo, o tracking não quebra** — o Worker detecta a tabela ausente, escreve um
aviso no log com o comando exato e segue mandando `Purchase`. Você perde a classificação, não a
venda. Mas o aviso só aparece no `wrangler tail`: **confirme a tabela aqui**, não depois.

---

## Passo 3 — Configuração

```jsonc
{
  "subscription_tracking": {
    "enabled": true,
    "product_ids": ["7194235", "7194240"],      // os que SÃO assinatura
    "product_ids_avulso": ["8801122"]            // os de compra única (projeto misto)
  },

  // só quando o cliente já otimiza por Purchase (Passo 1.2)
  "subscription_events": { "new": ["Purchase", "Subscribe"] },

  "platforms": {
    "google_ads": {
      "conversion_action_id_purchase": "{id da ação de AQUISIÇÃO}",
      "conversion_action_id_renewal": "{id da ação de RENOVAÇÃO}"
    }
  }
}
```

Em projeto 100% assinatura, `"subscription_tracking": true` (booleano) também funciona.

### O que cada `billing_type` dispara

| Cobrança | Meta (default) | Google Ads |
|---|---|---|
| `new` | `Subscribe` (ou array com `Purchase`) | ação de **aquisição**, primária, contagem **"Uma"** |
| `renewal` | `SubscriptionRenewal` (**custom**) | ação de **renovação**, secundária, contagem **"Todas"** |
| `reactivation` | `SubscriptionReactivation` (**custom**) | mesma ação de renovação |

Todo evento monetizado leva `billing_type` em `custom_data` (é a base das Conversões Personalizadas
e dos breakdowns) e `subscription_id` em `user_data` — campo oficial da CAPI, com a regra **"Do not
hash"**, que liga a aquisição às renovações do mesmo contrato.

> ⚠️ **Avise o cliente antes:** `SubscriptionRenewal` e `SubscriptionReactivation` são **eventos
> personalizados**. Eles **não** aparecem como conversão padrão no Gerenciador de Eventos, e o
> cliente **vai reportar isso como bug** se não for avisado. Para otimizar por eles é preciso criar
> uma **Conversão Personalizada** no Gerenciador.

### Google Ads: por que duas ações, e não uma

A ação de aquisição precisa ser contagem **"Uma"** (`ONE_PER_CLICK`) para o lance não inflar. Só que,
com ela, **a renovação no mesmo `gclid` é descartada** — e, se o cliente clicar num anúncio novo
antes de renovar, a renovação conta como **aquisição**, inflando a campanha. Por isso as recorrentes
sobem numa ação própria: `UPLOAD_CLICKS`, **secundária**, contagem **"Todas"**.

Sem `conversion_action_id_renewal`, renovação e reativação são **barradas com log legível**
(`renewal_action_not_configured`) — nunca sobem na ação errada. Higiene obrigatória: com Smart
Bidding o lance persegue **todas** as ações primárias; rebaixe a secundárias tudo que não for a
compra. Ver `.claude/playbooks/google_ads.md`.

---

## Passo 4 — Semeadura da base legada (não pode ser pulado)

**Bloco pronto para o cliente:**

> Preciso da lista dos seus assinantes para o sistema saber quem já era cliente antes do tracking
> existir. Exporte do painel do seu gateway (Assinaturas → Exportar CSV) com estas colunas:
>
> - **ID/código da assinatura** (na Ticto é o *Código do Pedido*) — obrigatório
> - **e-mail** do assinante
> - **situação** (Ativa / Atrasada / Cancelada)
> - plano/oferta, e a data da 1ª cobrança, se tiver
>
> ⚠️ **Inclua os CANCELADOS.** São eles que fazem o sistema reconhecer quando alguém que cancelou
> volta a assinar — sem isso, quem volta é contado como cliente novo. Se você vende por mais de um
> gateway, me mande **um arquivo por gateway**.

Depois, para cada arquivo:

```bash
npm run subs:import -- --csv=clientes-ticto.csv --site-id=meu-site --gateway=ticto
wrangler d1 execute tracking_db --file=./subscriptions-import.sql --remote
```

O script detecta o separador (`,` ou `;`), reconhece os nomes de coluna em português e inglês,
normaliza o e-mail e avisa se **nenhum cancelado** vier no arquivo. O SQL usa
`ON CONFLICT DO NOTHING`: rodar duas vezes não duplica nem sobrescreve o que o webhook já gravou —
**o dado vivo sempre vence o import**.

Status em português **não precisa** de normalização: a comparação é case-insensitive por prefixo
`cancel`, o que cobre `Cancelada`, `cancelado` e `canceled` de uma vez.

Confira:

```bash
wrangler d1 execute tracking_db --remote --command \
  "SELECT status, COUNT(*) FROM subscriptions WHERE origin='legacy_import' GROUP BY status"
```

---

## Passo 5 — `triggers.lead` dentro do app logado

Num SaaS o script roda **dentro do app**, onde existem formulários de login, busca e recuperação de
senha. Com o trigger genérico, **todos** viram "Lead". Pior: disparar no submit conta **tentativa
recusada** como conversão — numa SPA quem decide se a conta existe é o back-end (senha fraca, e-mail
já cadastrado).

```jsonc
"triggers": {
  "lead": {
    "routes": [
      { "match": "login", "event": "login", "custom_data": { "method": "email" },
        "confirm_success": { "request_match": "auth/v1/token?grant_type=password", "timeout_ms": 20000 } },
      { "match": "esqueci-senha|redefinir-senha", "event": "none" },
      { "event": "complete_registration",
        "field_selector": "[id$=sobrenome],[name$=sobrenome]",
        "confirm_success": { "request_match": "auth/v1/signup", "timeout_ms": 20000 } }
    ]
  }
}
```

- `match` casa por **substring no pathname** (pipe = OU); a 1ª rota que casa vence; rota sem `match`
  é o default; `event: "none"` não dispara nada.
- `confirm_success` deixa o evento **armado** no submit (os dados são extraídos ali, antes de o form
  limpar) e só dispara quando a requisição casada responde **2xx**. Erro ou timeout **descartam**.
- `request_match` **aceita query string** — é o que separa o login real
  (`token?grant_type=password`) do refresh silencioso de sessão, que bate no mesmo endpoint.
- `field_selector` prende o evento aos forms certos: em SPA o id do `<form>` muda a cada build, mas
  o conjunto de campos não.
- Quando não há cadastro a medir: `"lead": { "type": "disabled" }` — e ele agora é **de fato lido**.

**Efeito medido em produção:** antes, `lead` = 210/dia misturando tudo. Depois: `lead` 27 +
`login` 167 = **194** — mesmo total, agora separado, com `lead` significando **cadastro confirmado**.

A captura de identidade (cookies `marca_*` e beacon `identify`) **não** depende desses gates —
identidade não é conversão, e é ela que alimenta a atribuição da renovação (Passo 6).

---

## Passo 6 — Atribuição da renovação (e o falso alarme que ela causa)

A renovação é **100% server-side**: não há navegador, e o payload vem sem identificador de clique.
O VT recupera a identidade por **e-mail**, casando o webhook com a linha mais recente do `user_store`
— alimentada pelo `lead` e pelo beacon `identify`, que dispara sempre que um e-mail válido é digitado
num formulário. Num SaaS, **o login do app faz esse trabalho sozinho, todo dia**, e a linha se renova
(a retenção de 90 dias nunca vence para assinante ativo).

**Eficácia medida em produção:** apenas **2 de 90** webhooks traziam o indexador no payload — e ainda
assim **21 conversões saíram com identidade, 19 recuperadas pelo merge por e-mail**.

> ⚠️ **A atribuição de renovação começa baixa por COBERTURA, não por defeito.** No caso real, 129 de
> 655 assinantes ativos identificados (**19,7%**) produziram **16%** de atribuição nas renovações —
> ou seja, o sistema entregava praticamente tudo o que a cobertura permitia. A curva sobe sozinha
> conforme a base loga. Meça o teto antes de diagnosticar problema:

```sql
SELECT (SELECT COUNT(*) FROM subscriptions WHERE lower(status) NOT LIKE 'cancel%') AS ativos,
       (SELECT COUNT(*) FROM subscriptions s WHERE lower(s.status) NOT LIKE 'cancel%'
          AND EXISTS (SELECT 1 FROM user_store u WHERE lower(u.email)=lower(s.email) AND u.email<>''))
       AS identificados;
```

---

## Passo 7 — Validar antes de ligar de vez (modo shadow, opcional)

Quando o cliente ainda tem pixels antigos no checkout e não quer dois envios ao mesmo tempo:

```jsonc
"purchase_dispatch": "shadow"
```

O webhook processa **tudo** — parse, dedup, `billing_type`, tabela `subscriptions` — e grava no
`events` o que **teria** sido enviado (`status_code 0`, `error_message` começando com `shadow_mode`),
sem enviar nada. Dá para conferir a classificação com vendas reais de produção antes do corte:

```sql
SELECT event_name, COUNT(*) FROM events
 WHERE error_message LIKE 'shadow_mode%' GROUP BY event_name;
```

Ligar de verdade = **remover a chave** do config e fazer deploy.

---

## Checklist de entrega

- [ ] Gateway com recorrência mapeada (Ticto/Hotmart — ou `/new-gateway` concluído)
- [ ] Eventos de **renovação/cobrança recorrente** e de **cancelamento** ligados no painel do gateway
      (normalmente só "venda aprovada" vem marcado)
- [ ] `migrations/004` aplicada e conferida
- [ ] `subscription_tracking` no config (com as listas de produto, se misto)
- [ ] Evento de aquisição decidido **com o cliente** (Passo 1.2) e gravado na memória
- [ ] 2ª ação de conversão criada no Google Ads (`UPLOAD_CLICKS`, secundária, "Todas") e o id no config
- [ ] Conversões Personalizadas criadas no Meta para `SubscriptionRenewal`/`SubscriptionReactivation`
- [ ] Base legada semeada, **com os cancelados**
- [ ] `triggers.lead.routes` configurado, se o script roda em app logado
- [ ] Os três `billing_type` observados no D1 depois do 1º ciclo (ver `/audit-tracking`, seção 2.11)
- [ ] Cliente avisado de que `SubscriptionRenewal` é evento personalizado
- [ ] Cliente avisado de que a atribuição de renovação **sobe com o tempo** (Passo 6)

---

## Erros comuns

| Sintoma | Causa | Correção |
|---|---|---|
| Toda cobrança sai como `Purchase`, mesmo com o modo ligado | migração 004 não aplicada | rodar o Passo 2 (`wrangler tail` mostra o aviso com o comando) |
| Renovação não chega a plataforma nenhuma | parser usando o id da assinatura como `order_id` → cai no dedup | conferir a distinção fatura × contrato em `.claude/references/gateway-webhooks.md` |
| Pico de "clientes novos" no 1º ciclo | base legada não semeada | Passo 4 |
| `renewal_action_not_configured` no D1 | falta a 2ª ação de conversão | criar a ação e preencher `conversion_action_id_renewal` |
| Cliente diz que `SubscriptionRenewal` "não existe" no Gerenciador | é evento personalizado | criar Conversão Personalizada; avisar antes |
| Renovação orgânica com `marca_user` = `"Não Informado"` | placeholder que a Ticto manda em campo vazio | já tratado no parser — se aparecer em outro gateway, filtrar igual |
| Produto avulso virando `Subscribe` | ID não classificado nas listas | preencher `product_ids` / `product_ids_avulso` (o D1 já registra o aviso) |
