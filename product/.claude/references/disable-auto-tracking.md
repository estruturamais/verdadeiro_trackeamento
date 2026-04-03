# Reference: Desativar Configuracoes Automaticas de Tracking

Antes de coletar credenciais, orientar o usuario a desativar estas configuracoes — elas causam dupla contagem quando o tracking server-side estiver ativo.

---

## GA4 — Desativar Medicao Otimizada (Enhanced Measurement)

A Medicao Otimizada do GA4 dispara `page_view` automaticamente no browser. Com o tracking server-side ativo, o `page_view` sera enviado via CAPI — resultado: cada pageview conta duas vezes.

**Caminho:**
> GA4 > Administrador > Fluxos de dados > Web > selecionar o stream > Medicao Otimizada

**O que desativar:**
- Visualizacoes de pagina — **OBRIGATORIO** (conflita diretamente com o tracking server-side)

**O que pode manter ativo** (nao conflita com o sistema):
- Rolagem de pagina
- Cliques externos
- Pesquisa no site
- Engajamento com video
- Downloads de arquivo

**Instrucao ao cliente:**
> "No GA4, vou precisar que voce desative uma configuracao que causa contagem duplicada. Acesse: Administrador > Fluxos de dados > Web > clique no seu site > Medicao Otimizada > desligue 'Visualizacoes de pagina'. Pode manter o restante ativado."

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

Se o usuario relatar que os eventos aparecem dobrados no painel da plataforma: verificar se esta configuracao foi desativada antes de investigar outros problemas.
