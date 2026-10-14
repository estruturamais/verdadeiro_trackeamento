# Reference: Desativar Configuracoes Automaticas de Tracking

Antes de coletar credenciais, orientar o usuario sobre estas configuracoes automaticas: algumas causam dupla contagem com o tracking server-side ativo (Meta), outras precisam ficar ligadas (o `page_view` do GA4, desde a 1.9.1).

---

## GA4 — Medicao otimizada: NAO desligar o page_view (desde a 1.9.1)

Ate a 1.9.0 este reference mandava desligar "Visualizacoes de pagina" porque o `page_view` do GA4 ia
pelo servidor. **Isso deixou de valer:** desde a 1.9.1 o `page_view` do GA4 **e** o do navegador — o
gtag do VT o envia no `config` (`send_page_view: true`) pelo proxy proprio `/g/collect`, e o Worker
nao o envia mais pelo Measurement Protocol. Nao ha duplicidade a evitar no `page_view` de carga.

**O comportamento oficial** (Google, conferido em 14/10/2026):
- [Enhanced measurement events](https://support.google.com/analytics/answer/9216061): "Visualizacoes
  de pagina" (`page_view`) e enviado "sempre que a pagina e carregada ou o estado do historico de
  navegacao e alterado pelo site ativo", "e coletado automaticamente e nao pode ser desativado". Uma
  configuracao avancada dessa opcao controla o envio com base nos eventos do historico do navegador —
  ela escuta `pushState`, `popState` e `replaceState`.
- [Measure pageviews](https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag):
  essa configuracao se chama *"Page changes based on browser history events"* (na interface em
  portugues, as alteracoes de pagina com base em eventos do historico do navegador — conferir o texto
  na tela), e os `page_view` de historico saem **mesmo com `send_page_view: false`**.
- [Measure single-page applications](https://developers.google.com/analytics/devguides/collection/ga4/single-page-applications?implementation=browser-history):
  para SPA que usa a History API (`pushState`/`replaceState`), o caminho recomendado e justamente
  essa opcao ligada, junto com as cargas de pagina.

**O que fazer, por tipo de site** (o `tipo_site` do Step 2):
- **Site tradicional** (cada pagina e uma carga): manter a medicao otimizada ligada e **desmarcar a
  opcao do historico** de "Visualizacoes de pagina". Nao ha troca de rota a medir, e o proprio VT
  reescreve a URL da pagina com `replaceState` na carga (as UTMs da jornada): se o gtag carregar
  antes dessa reescrita (pagina pesada, `gtag.js` em cache), um container com a opcao ligada manda um
  **2o `page_view`** da mesma pagina — medido no Chrome com um container real com a opcao ligada, e
  ja acontecia ate a 1.9.0 (la como 1 pelo navegador + 1 pelo MP).
- **SPA / quiz** (troca de tela sem recarregar, por `pushState`): manter a opcao do historico
  **ligada** — e ela que conta cada troca de rota como `page_view`, com a mesma identidade da 1a carga.
  As trocas de rota ja saiam pelo gtag na 1.9.0 (a doc acima: mesmo com `send_page_view: false`); o
  que mudou na 1.9.1 e que a 1a carga tambem sai pelo navegador. O 2o `page_view` da reescrita de URL
  descrito acima tambem pode aparecer aqui.
- Rolagem, cliques externos, pesquisa no site, engajamento com video e downloads: podem ficar ligados
  (sao eventos do navegador; o VT nao os envia).

**Instrucao ao cliente:**
> "No GA4, confira em Administrador > Fluxos de dados > Web > clique no seu site que a Medicao
> otimizada esta ligada — nao desligue 'Visualizacoes de pagina'." Site tradicional, acrescentar: "Nas
> configuracoes da Medicao otimizada, em Visualizacoes de pagina, desmarque a opcao avancada de
> alteracoes de pagina pelo historico do navegador — seu site nao troca de tela sem recarregar."

---

## Meta Ads — Desativar Deteccao Automatica de Eventos

A Deteccao Automatica de Eventos (anteriormente "Eventos Automaticos") do Meta dispara eventos no browser sem configuracao. Com o tracking server-side ativo, os mesmos eventos sao enviados via CAPI — resultado: eventos duplicados, otimizacao prejudicada.

**Caminho:**
> Meta Business Suite > Events Manager > Fontes de dados > selecionar o pixel > Configuracoes > Deteccao Automatica de Eventos

**O que desativar:**
- Todos os eventos automaticos — **OBRIGATORIO**

**Instrucao ao cliente:**
> "No Meta, preciso que voce desative os eventos automaticos que conflitam com o nosso sistema. Acesse: Events Manager > selecione seu pixel > Configuracoes > Deteccao Automatica de Eventos > desative tudo. Isso nao afeta os dados — continuara recebendo normalmente pelo servidor."

---

## Quando orientar

Orientar no **Step 3**, imediatamente apos confirmar quais plataformas serao usadas e antes de coletar credenciais. O usuario precisa fazer isso antes do deploy para que os primeiros eventos ja cheguem sem duplicacao.

Se o usuario relatar que os eventos aparecem dobrados no painel da plataforma: verificar estas configuracoes antes de investigar outros problemas (Meta: deteccao automatica desligada; GA4: `page_view` dobrado em site tradicional = a opcao do historico ligada — ver acima).
