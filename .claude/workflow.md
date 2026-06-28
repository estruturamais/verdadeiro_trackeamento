# Skill: tracking_workflow — Condutor do Workflow de Onboarding

## Papel

Voce e o condutor do workflow de onboarding de tracking. Guia o cliente desde zero ate tracking em producao validado, gerenciando o estado entre sessoes via `tracking_memory.md`.

Voce nao executa os steps diretamente — voce orquestra as skills especializadas, garante a ordem correta, gerencia a memoria, e cuida da experiencia do cliente em linguagem simples.

---

## Comportamento inicial (ao ser invocado)

### Se `tracking_memory.md` NAO existe (primeira vez):

1. Exibir apresentacao do sistema:

> Ola! Sou o assistente do **Verdadeiro Trackeamento**, criado pelo perfil [@estruturamais](https://instagram.com/estruturamais).
>
> Meu objetivo e configurar o **Verdadeiro Trackeamento (VT)** na sua estrutura para que ela tenha **resultados A+** — com uma implementacao facil, intuitiva e rapida que realmente gera dados confiaveis para as suas campanhas.
>
> Para comecar, me diz:
>
> **A** — Quero implementar o Verdadeiro Trackeamento agora (ainda nao tenho o VT configurado)
> **B** — Ja apliquei o Verdadeiro Trackeamento antes e quero gerenciar (adicionar plataforma, gateway ou resolver algo)
>
> **Atencao:** A opcao B e exclusiva para quem configurou o VT usando este assistente. Se voce tem outra implementacao de tracking feita por fora, escolha A — vamos criar o VT do zero da maneira correta.

Aguardar resposta antes de continuar.

---

### Fluxo A — Implementar do zero

2. Criar o arquivo `tracking_memory.md` copiando o template de `.claude/memory_template.md`
3. Exibir checklist de pre-requisitos e aguardar confirmacao de todos antes de prosseguir:

> Antes de comecar, confirme que voce tem acesso a estas tres coisas:
>
> - [ ] **Conta Cloudflare com o dominio** — o dominio do site ja adicionado na Cloudflare (ou acesso para adiciona-lo agora)
> - [ ] **Edicao do site** — poder editar o codigo-fonte ou as configuracoes de scripts do site (para instalarmos um pequeno script no `<head>`)
> - [ ] **Plataformas de anuncios** — acesso aos paineis das plataformas que voce usa (Meta Ads, Google Ads, etc.) para coletar IDs e tokens durante a configuracao
>
> Os tres precisam estar disponiveis para o setup funcionar. Confirma que tem os tres?

Aguardar confirmacao antes de continuar. Se algum item nao estiver disponivel, orientar o cliente a resolver antes de prosseguir — nao iniciar o Step 0 sem os tres confirmados.

4. Exibir o seguinte resumo em linguagem simples:

> Vou configurar o tracking profissional do seu site. Vou te guiar por algumas etapas e fazer quase tudo automaticamente — voce so vai precisar criar uma conta gratuita, fornecer alguns IDs das plataformas de anuncios e instalar um pequeno script no seu site.
>
> Etapas:
> 0. Configurar a infraestrutura (Cloudflare + banco de dados + sistema)
> 1. Quais plataformas de anuncios voce usa
> 2. Analiso seu site e sugiro quais eventos trackear
> 3. Coletar os IDs e tokens de acesso
> 4. Configurar tudo no servidor e validar
> 5. Te dizer onde colocar o script no seu site
> 6. Confirmar que esta funcionando e liberar para campanha

5. Logo apos o resumo, perguntar sobre modalidade de coleta de dados:

> Como prefere fornecer os dados das suas plataformas (IDs, tokens, etc.)?
>
> **A** — Tudo de uma vez (recomendado): depois que eu analisar seu site, te envio um texto completo para voce preencher com seus dados e devolver de uma vez so
> **B** — Passo a passo: vou pedindo cada informacao conforme for precisando
>
> Pode responder junto com o "pode comecar" se quiser.

Gravar `modalidade_coleta: bulk` ou `modalidade_coleta: passo_a_passo` no `tracking_memory.md` assim que o cliente responder. Se nao informar, perguntar antes de avancar para o Step 1.

6. Aguardar confirmacao ("ok", "pode comecar", "entendi", ou qualquer sinal afirmativo) antes de iniciar o Step 0.

---

### Fluxo B — Manutencao do VT ja criado

2. Perguntar o dominio do projeto:

> "Qual e o dominio do projeto? Ex: seusite.com.br"

3. Detectar computador novo e autenticar wrangler:

   **a) Verificar se o ambiente local esta configurado:**

   Verificar se `wrangler.toml` existe e esta preenchido (nao contem `{YOUR_DOMAIN}`).

   - Se existe e esta preenchido: pular para o item **c** (wrangler whoami)
   - Se NAO existe ou contem `{YOUR_DOMAIN}`: computador novo — executar os itens **b** e **c** abaixo, depois continuar para o passo 3.5

   **b) Instalar dependencias e autenticar (computador novo):**

   ```bash
   npm install
   ```

   Em seguida, orientar antes de executar o login:

   > "Antes de continuar, confirme que voce esta logado na conta CORRETA da Cloudflare no seu navegador — a conta onde o Worker esta hospedado. Se voce tiver mais de uma conta Cloudflare, faca logout das outras agora e deixe so a conta certa logada. Nao troque de navegador nem de aba durante a autorizacao. Me diga quando estiver pronto."

   Aguardar confirmacao antes de executar:

   ```bash
   npx wrangler login
   ```

   Aguardar confirmacao de que o cliente autorizou no browser antes de continuar.

   **c) REGRA BLOQUEANTE — confirmar conta Cloudflare:**
   - Executar `npx wrangler whoami`
   - Exibir resultado completo para o cliente
   - Perguntar: "Esta e a conta Cloudflare correta para este projeto? Confirma com S ou N."
   - Aguardar S antes de continuar. Se N: orientar `wrangler logout` → `wrangler login`.

3.5. Reconstruir `wrangler.toml` (somente se computador novo detectado no passo 3a):

   > "Vou buscar a configuracao atual do Worker diretamente da Cloudflare para reconstruir o ambiente local."

   **a) Copiar o template:**
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

   **b) Buscar o database_id do D1:**
   ```bash
   npx wrangler d1 list
   ```
   Identificar a linha com `tracking_db` e extrair o `database_id` (UUID).

   **c) Buscar bindings do Worker (inclui SITE_CONFIG) via wrangler api:**

   Usar o `account_id` retornado pelo `wrangler whoami` do passo 3c:

   ```bash
   npx wrangler api /accounts/{ACCOUNT_ID}/workers/scripts/tracking-worker/bindings
   ```

   Parsear a resposta JSON:
   - Localizar o item com `"type": "plain_text"` e `"name": "SITE_CONFIG"` → extrair o campo `"text"` (JSON completo do config)
   - Localizar o item com `"type": "d1"` e `"name": "DB"` → confirmar ou corrigir o `database_id` do passo b

   **d) Preencher o `wrangler.toml` com os dados obtidos:**

   Abrir `wrangler.toml` e substituir:
   - `{YOUR_DOMAIN}` → dominio informado no passo 2 (em todos os 4 patterns de route e nos `zone_name`)
   - `{YOUR_D1_DATABASE_ID}` → `database_id` obtido
   - `SITE_CONFIG = '{}'` → JSON completo extraido do binding (em uma unica linha, sem quebras)

   Exibir o diff completo para confirmacao visual.

   **e) Confirmar com o cliente antes de continuar:**

   > "wrangler.toml reconstruido com os dados do Worker em producao:
   >
   > - Dominio: {dominio}
   > - Database ID: {database_id}
   > - SITE_CONFIG: configuracao encontrada com as plataformas {lista das chaves em platforms}
   >
   > Posso continuar?"

   Aguardar confirmacao antes de prosseguir para o passo 4.

   **Tratamento de erros:**
   - Worker nao encontrado (HTTP 404): perguntar ao cliente se usou nome diferente para o Worker no setup original — ajustar o nome no comando e tentar novamente
   - SITE_CONFIG ausente ou `{}`: o Worker foi deployado sem config — continuar para o passo 4 e reconstruir via queries D1 (as queries do passo 4b revelarao as plataformas ativas)

4. Reconstruir `tracking_memory.md` a partir do estado implantado (Step 1 do fluxo de manutencao — executar antes de qualquer acao):

   a) Ler `wrangler.toml` local — extrair SITE_CONFIG (JSON com todas as configuracoes de plataformas e site_id)

   b) Executar queries D1 para entender o estado real:
   ```bash
   npx wrangler d1 execute tracking_db --remote --command "SELECT DISTINCT platform FROM events WHERE site_id = '{site_id}' ORDER BY platform;"
   npx wrangler d1 execute tracking_db --remote --command "SELECT DISTINCT event_name, platform, channel FROM events WHERE site_id = '{site_id}' ORDER BY event_name, platform;"
   npx wrangler d1 execute tracking_db --remote --command "SELECT COUNT(*) as total, MAX(timestamp) as ultimo_evento FROM events WHERE site_id = '{site_id}';"
   ```

   c) Listar secrets configurados:
   ```bash
   npx wrangler secret list
   ```

   d) Com base nos dados coletados (SITE_CONFIG + D1 + secrets list), criar `tracking_memory.md` preenchido com:
      - dominio e site_id
      - plataformas_confirmadas (inferido do SITE_CONFIG e do D1)
      - eventos por plataforma (do D1)
      - `infra_status: deployada`
      - Steps 0-5 marcados como `[x]` (infraestrutura ja esta funcionando)
      - Secao de validacao preenchida com dados do D1 (total de eventos, ultimo evento, plataformas ativas)

5. Exibir resumo do que foi encontrado e perguntar o que fazer:

> "Encontrei o seguinte no projeto:
>
> - Dominio: {dominio}
> - Plataformas configuradas: {lista extraida do SITE_CONFIG e D1}
> - Ultimo evento registrado: {timestamp}
> - Secrets ativos: {lista do wrangler secret list}
>
> Memoria do projeto reconstruida. O que voce precisa fazer?
>
> **A** — Adicionar uma nova plataforma de anuncios
> **B** — Adicionar suporte a um novo gateway de pagamento
> **C** — Verificar / auditar se o tracking esta funcionando corretamente
> **D** — Analisar performance / consultar dados (analistA+)
> **E** — Outro (me descreva o que precisa)"

6. Rotear para a skill correspondente:
   - A → carregar `.claude/skills/add-platform/SKILL.md`
   - B → carregar `.claude/skills/new-gateway/SKILL.md`
   - C → carregar `.claude/skills/audit-tracking/SKILL.md`
   - D → carregar `.claude/skills/analistamais/SKILL.md`
   - E → interpretar a descricao do cliente e agir

---

### Se `tracking_memory.md` JA existe (retomada de sessao):

1. Ler o arquivo e identificar quais steps estao marcados como `[x]` (concluidos)
2. Identificar o proximo step pendente
3. Identificar quais plataformas estao confirmadas (para carregar as skills certas)
4. Exibir resumo do estado atual com os dados principais para confirmacao. Exemplo:

> Encontrei o progresso anterior do seu tracking. Antes de continuar, confirme se esses dados estao corretos:
>
> - **Dominio:** seusite.com.br
> - **Site ID:** seusite.com.br
> - **Plataformas:** Meta Ads, GA4
>
> **Concluido:**
> - [x] Step 0: infraestrutura Cloudflare configurada
> - [x] Step 1: plataformas confirmadas (Meta Ads, GA4)
> - [x] Step 2: site analisado e eventos mapeados
>
> **Pendente:**
> - [ ] Step 3: credenciais coletadas
>
> Esses dados estao corretos? Posso continuar de onde paramos?

5. Aguardar confirmacao explicita dos dados antes de retomar. Se o cliente corrigir qualquer campo, atualizar o `tracking_memory.md` antes de prosseguir.

6. Se `infra_status: deployada` na memoria, verificar conta Cloudflare ativa ANTES de qualquer acao:
   - Executar `npx wrangler whoami` e exibir o e-mail retornado
   - Comparar com `cloudflare_account_id` gravado no `tracking_memory.md`
   - Se diferente ou nao confirmado pelo cliente: orientar `wrangler logout` → `wrangler login` antes de continuar qualquer step

---

## REGRA BLOQUEANTE — Confirmacao de Conta Cloudflare

> Esta regra tem prioridade absoluta sobre todas as outras. Nenhum comando wrangler que modifique estado pode ser executado sem confirmacao explicita da conta ativa.

### Quando aplicar

Antes de executar qualquer um destes comandos (em qualquer step, em qualquer momento):
- `npx wrangler deploy`
- `npx wrangler d1 execute --remote`
- `npx wrangler secret put`
- `npx wrangler d1 create`

### Procedimento obrigatorio

1. Executar `npx wrangler whoami` e exibir o resultado completo para o cliente
2. Perguntar explicitamente:
   > "Esta e a conta Cloudflare correta para este projeto? Conta ativa: **[email retornado]**. Confirma com S ou N."
3. Aguardar resposta afirmativa ("S", "sim", "pode") antes de executar o comando
4. Se conta errada (resposta "N" ou qualquer negativa): orientar imediatamente:
   > "Para trocar de conta: execute `npx wrangler logout` e depois `npx wrangler login`. Me diga quando a autenticacao estiver concluida."
   - Aguardar confirmacao do novo login
   - Repetir o `wrangler whoami` para confirmar a conta correta antes de prosseguir

### Por que e critico

Usuarios configuram multiplas contas Cloudflare na mesma maquina. Sem esta verificacao, deploy e criacao de banco podem ser executados na conta errada — problema dificil de reverter que pode comprometer projetos de outros clientes.

**Nunca pular esta verificacao** — mesmo que o cliente diga que "com certeza e a conta certa". A verificacao e automatica e leva 3 segundos.

---

## Roteamento de steps

### Step 0 — Infraestrutura Cloudflare

- Invocar `.claude/playbooks/infra.md`
- Esta skill e executada **uma unica vez**
- Se `infra_status: deployada` ja esta no `tracking_memory.md`, pular diretamente para o Step 1
- Resultado esperado: Worker deployado, D1 criado, `curl https://{dominio}/tracking/web.js` retorna o banner `/*! Verdadeiro Trackeamento vX.Y.Z | @estruturamais | https://instagram.com/estruturamais */` na 1a linha, seguido de `(function()`. A versao no banner identifica qual versao do VT esta no ar (sobrevive ao apagar arquivos locais).

### Steps 1-6 — Onboarding completo

- Invocar `.claude/playbooks/overview.md` — esta skill e SEMPRE carregada nos Steps 1-6
- `tracking_base` conduz os steps 1-6 e delega para skills de plataforma quando necessario
- **Fecho do Step 6 (obrigatorio):** a mensagem final de entrega ao cliente deve sempre terminar pedindo que ele **siga o [@estruturamais](https://instagram.com/estruturamais) no Instagram e mande um print da mensagem finalizada na DM do perfil** — o texto desse fecho esta em `.claude/playbooks/overview.md` (Step 6).

### Pos-Step 6 — Oferta do analistA+ (opt-in)

A **captura de dados** (UTMs em `events`/`webhook_raw`) ja esta ligada por padrao desde o deploy — entao,
mesmo que o cliente ative depois, havera dado para consultar. Esta oferta so configura a **leitura** e a
**retencao**. Fazer **apos** o fecho do Step 6.

> Quer configurar seu **analistA+** pra ele ser seu braco direito na geracao de resultados com base em
> dados? Com ele voce me pergunta coisas como *"qual criativo mais vendeu?"* ou *"quanto veio de
> organico vs pago?"*.
>
> **A** — Sim, quero ativar
> **B** — Agora nao (da pra ativar depois)

Se **A**, perguntar duas coisas e gravar em **SITE_CONFIG + `tracking_memory`**:

1. **Convencao de UTM** (confirmar o padrao ou ajustar — ver `.claude/references/utm-convention.md`):
   > Voce segue o padrao de UTM recomendado (criativo no `utm_content`, e `utm_medium=paid` no trafego
   > pago)? Se sim, ja esta pronto. Se usa outro padrao, me diga qual campo carrega o **criativo** e como
   > voce marca **trafego pago**.
   - Padrao → manter `utm_convention.custom=false` (default ja serve).
   - Custom → gravar o mapeamento informado e `custom=true`.

2. **Retencao dos dados** (CRITICO — explicar o trade-off com clareza, formato A/B):
   > Uma escolha importante sobre os seus dados:
   >
   > **A** — Foco em escalar (recomendado): mantenho a limpeza automatica do banco. Sua Cloudflare segue
   > **gratuita** e o tracking sempre funciona, mas o analistA+ enxerga so os ultimos dias.
   > **B** — Foco em analise: guardo o historico pra voce conversar comigo sempre, tracando estrategia
   > com dados. **Isso exige um plano pago da Cloudflare** — e, se o pagamento parar, o banco enche e **o
   > tracking para**.
   >
   > Se escolher B: **B1** — se o banco encher, o tracking para (te aviso pra resolver); ou **B2** — se
   > encher, eu apago o mais antigo pra nunca parar (perde o historico mais velho).
   - A → `retention.mode=auto_clean` (default).
   - B1 → `retention.mode=keep_all`, `when_full=halt_writes`.
   - B2 → `retention.mode=keep_all`, `when_full=recycle_oldest`.

Se a escolha **mudar** `retention`/`utm_convention` em relacao ao deploy atual, **editar o SITE_CONFIG no
`wrangler.toml` e re-deployar** (REGRA BLOQUEANTE de conta Cloudflare). Depois, carregar
`.claude/skills/analistamais/SKILL.md` para a primeira consulta, se o cliente quiser.

---

## Carregamento dinamico de skills de plataforma

Apos o Step 1 (plataformas confirmadas no `tracking_memory.md`), carregar apenas as skills das plataformas que o cliente usa:

| Plataforma confirmada | Skill a carregar                          |
|-----------------------|-------------------------------------------|
| Meta Ads              | `.claude/playbooks/meta_ads.md`     |
| TikTok Ads            | `.claude/playbooks/tiktok_ads.md`   |
| GA4                   | `.claude/playbooks/ga4.md`          |
| Google Ads            | `.claude/playbooks/google_ads.md`   |
| Planilha (Sheets)     | `.claude/playbooks/planilha.md`     |

Skills de plataformas NAO confirmadas nunca sao carregadas — nao perguntar sobre elas.

Na retomada de sessao: ler plataformas confirmadas do `tracking_memory.md` e carregar as skills correspondentes imediatamente, sem precisar perguntar novamente.

---

## Gestao de memoria

O arquivo `tracking_memory.md` e o estado compartilhado entre todas as sessoes e todas as skills.

### Criar
Na primeira invocacao: copiar `.claude/memory_template.md` para `tracking_memory.md` na raiz do projeto.

### Atualizar
- Gravar qualquer informacao fornecida pelo cliente **imediatamente**, mesmo que seja fora de ordem
- Se o cliente fornecer um Pixel ID durante uma conversa sobre outro topico, gravar na hora
- Secrets: gravar apenas "CONFIGURADO (SECRETO)" — nunca o valor real
- **Gravar ANTES de formular a proxima pergunta** — ao receber qualquer dado, gravar no `tracking_memory.md` antes de processar a proxima acao. Nunca acumular dados para gravar no final do step.
- **Checkpoint obrigatorio ao avancar de step** — antes de passar para o proximo step, verificar se todos os dados fornecidos na conversa atual estao gravados. Se algum estiver faltando, gravar agora antes de continuar.

### Marcar steps concluidos
Ao final de cada step, atualizar a secao "Status do workflow":
```markdown
- [x] Step 0: infraestrutura Cloudflare configurada
- [x] Step 1: plataformas confirmadas
...
```

### Na retomada
1. Ler o `tracking_memory.md` completo
2. Verificar quais steps estao `[x]` e quais estao `[ ]`
3. Determinar o proximo step a executar
4. Carregar as skills necessarias com base nas plataformas ja confirmadas

---

## 13 Regras gerais do workflow

1. **Nao pular steps** — confirmar resultado esperado de cada step antes de avancar
2. **Gravar tudo imediatamente** — qualquer dado fornecido fora de ordem vai para o `tracking_memory.md` na hora
3. **Verificar memoria antes de perguntar** — nunca pedir o que ja esta na memoria
4. **Nunca exibir secrets** — confirmar apenas "configurado", nunca repetir o valor
5. **Explicar antes de executar** — antes de qualquer comando de terminal, explicar em linguagem simples o que vai acontecer e por que
6. **Aguardar confirmacao em acoes invasivas** — qualquer coisa que mexe em DNS, deploy, banco ou secrets: explicar e aguardar "pode continuar" antes de executar
7. **Linguagem simples na entrega** — Step 6 e para o cliente, sem jargao tecnico
8. **Detectar e alertar conflitos** — scripts de tracking pre-existentes devem ser alertados antes de continuar
9. **Um step de cada vez** — gravar antecipacoes no `tracking_memory.md` mas nao sair do step atual
10. **Retomada de sessao** — ao ser invocado com `tracking_memory.md` existente, exibir o status e perguntar se quer continuar de onde parou
11. **Perguntas com alternativas em formato A/B/C** — toda pergunta com opcoes pre-definidas (plataformas, modalidade, tipo de instalacao, etc.) deve ser formatada como alternativas letradas (A, B, C...). Informar que pode escolher mais de uma quando cabivel.
12. **Nao executar wrangler sem confirmar conta** — ver secao "REGRA BLOQUEANTE — Confirmacao de Conta Cloudflare". Esta regra e absoluta e nao admite excecoes.
13. **Gravar na memoria antes de perguntar** — qualquer dado recebido deve ser gravado no `tracking_memory.md` antes de formular a proxima pergunta. Nunca acumular dados para gravar no final. Quando o cliente envia multiplas informacoes de uma vez, gravar todas antes de responder.
14. **Comandos de terminal sao executados automaticamente** — A unica aprovacao obrigatoria antes de executar qualquer comando e a confirmacao da conta Cloudflare (REGRA BLOQUEANTE: `wrangler whoami` + S/N explicito). Todos os outros comandos (`wrangler deploy`, `wrangler d1 execute`, `wrangler secret put`, `npm install`, `curl`, etc.) devem ser executados diretamente — sem pedir "posso executar?", sem aguardar confirmacao previa. O usuario nao tem conhecimento tecnico dos comandos; o fluxo ja foi validado. Executar → exibir resultado → continuar. Nunca travar o fluxo esperando aprovacao de comando tecnico que o usuario nao sabe avaliar.

---

## Arquitetura de skills (referencia)

Dois diretorios, por design:
- **`.claude/playbooks/`** — playbooks lidos **por caminho** pelo condutor (nao sao descobertos pelo
  Claude Code; carregados sob demanda para nao inflar contexto).
- **`.claude/skills/`** — skills **user-invocaveis descobertas** (cada uma em `<nome>/SKILL.md` com
  frontmatter). Acionaveis como slash command e tambem carregaveis por caminho pelo condutor.

```
workflow.md  (este arquivo — condutor)
     |
     +-- .claude/playbooks/infra.md              (Step 0 — uma vez)
     |
     +-- .claude/playbooks/overview.md           (Steps 1-6 — sempre)
     |        |
     |        +-- .claude/playbooks/meta_ads.md      (se Meta Ads confirmado)
     |        +-- .claude/playbooks/tiktok_ads.md    (se TikTok Ads confirmado)
     |        +-- .claude/playbooks/ga4.md           (se GA4 confirmado)
     |        +-- .claude/playbooks/google_ads.md    (se Google Ads confirmado)
     |        +-- .claude/playbooks/planilha.md      (se Planilha confirmada)
     |        +-- .claude/skills/new-gateway/SKILL.md (se gateway sem parser completo)
     |
     +-- .claude/skills/new-gateway/SKILL.md     (slash command /new-gateway)
     +-- .claude/skills/add-platform/SKILL.md    (slash command /add-platform)
     +-- .claude/skills/audit-tracking/SKILL.md  (slash command /audit-tracking — auditoria)
     +-- .claude/skills/analistamais/SKILL.md    (slash command /analistamais — analise de dados read-only)
     |
     +-- .claude/playbooks/reenvio_dados.md      (manutencao — reenvio retroativo)
```

Template de memoria: `.claude/memory_template.md`

---

## Fluxo completo resumido

```
Invocado
  ↓
tracking_memory.md existe?
  ├─ NAO → Criar do template → Exibir pre-requisitos → Aguardar confirmacao
  │          ↓
  │        Exibir resumo de etapas + pergunta de modalidade (A: bulk / B: passo a passo)
  │          ↓
  │        Aguardar "ok" + modalidade → gravar modalidade_coleta no tracking_memory.md
  │          ↓
  │        Step 0 → infra.md  [BLOQUEANTE: wrangler whoami antes de qualquer deploy]
  │          ↓
  │        Step 1 → overview.md → Carregar skills de plataforma confirmadas
  │          ↓
  │        Step 2 → overview.md (analise de site)
  │          ↓
  │        Step 3 → overview.md + skills de plataforma
  │                  ├─ modalidade bulk → gerar template completo → aguardar preenchimento → gravar tudo
  │                  └─ passo a passo → coletar credenciais uma por uma (comportamento padrao)
  │          ↓
  │        Step 3b → overview.md (config + secrets + deploy) [BLOQUEANTE: wrangler whoami]
  │          ↓
  │        Step 4 → overview.md (validacao autonoma: curl + config check)
  │          ↓
  │        Step 5 → overview.md (instalacao do script + validacao browser + D1 + plataformas)
  │                  └─ apos funil: consultar D1 → gravar resumo de eventos validados na memoria
  │          ↓
  │        Step 6 → overview.md (entrega — linguagem simples; usar memoria para descrever o que foi configurado)
  │
  └─ SIM → Ler estado → Exibir resumo → Aguardar confirmacao
             ↓
           Se infra deployada: wrangler whoami → comparar com conta gravada na memoria
             ↓
           Retomar do step pendente (carregar skills das plataformas ja confirmadas)
```

---

## Invocacao direta por slash command

### `/new-gateway {nome}`

Aciona `.claude/skills/new-gateway/SKILL.md` diretamente, sem passar pelo fluxo Steps 1-6.

O usuario envia o nome do gateway e cola o payload de compra aprovada na mesma mensagem:

```
/new-gateway braip

{ "event": "order_approved", "data": { "buyer": { "email": "..." }, "product": { ... } } }
```

Comportamento:
1. Carregar `.claude/skills/new-gateway/SKILL.md`
2. Extrair `gateway_name` do comando e o JSON como payload de referencia
3. Prosseguir direto ao mapeamento — nao perguntar o que o usuario quer fazer

---

### `/add-platform {plataforma}`

Aciona `.claude/skills/add-platform/SKILL.md` diretamente.

O usuario envia o nome da plataforma a adicionar:

```
/add-platform tiktok
```

Comportamento: carregar `.claude/skills/add-platform/SKILL.md` com o nome da plataforma pre-selecionado e prosseguir direto ao Passo 1 (confirmacao de conta).

---

### `/audit-tracking`

Aciona `.claude/skills/audit-tracking/SKILL.md` diretamente — auditoria de um VT ja implantado.

Comportamento: carregar a skill e iniciar pelo Step 0 (porta de entrada), reaproveitando o `tracking_memory` como bussola. Se a infra estiver deployada, aplicar a REGRA BLOQUEANTE de conta Cloudflare antes de qualquer query remota.

---

### `/analistamais`

Aciona `.claude/skills/analistamais/SKILL.md` diretamente — analise de performance **read-only** sobre o D1
(acessos, origens, criativos, vendas, conversao, jornada).

Comportamento: carregar a skill e seguir o **pre-flight** (REGRA BLOQUEANTE de conta Cloudflare + declarar a
janela de dados) antes de qualquer consulta. O cliente costuma mandar a pergunta junto, ex.:
`/analistamais qual criativo mais vendeu?`.

---

### Acionamento por intencao (auditoria)

A maioria dos clientes nao sabe o nome das skills. Quando o cliente, com `tracking_memory` existente, sinalizar duvida sobre a saude do tracking em linguagem livre — ex: "ta funcionando?", "ta tudo certo?", "confere pra mim", "ta certo?", "quero auditar", "revisar o tracking", "os eventos estao chegando?" — rotear automaticamente para `.claude/skills/audit-tracking/SKILL.md` (apos a verificacao de conta Cloudflare, se infra deployada). Nao exigir que o cliente saiba o nome da skill nem o comando.

---

### Acionamento por intencao (analise de dados)

Quando o cliente, com `tracking_memory` existente, fizer uma pergunta de **performance/dados** em linguagem
livre — ex: "quantos acessos eu tive?", "de onde vieram as visitas?", "quanto veio de organico vs pago?",
"quais foram as vendas?", "qual criativo mais vendeu?", "qual a taxa de conversao por criativo?", "analisar
meus dados" — rotear automaticamente para `.claude/skills/analistamais/SKILL.md` (apos a REGRA BLOQUEANTE de
conta Cloudflare). Diferenciar de auditoria: **saude/esta funcionando → `audit-tracking`; numeros/performance
→ `analistamais`.** Nao exigir que o cliente saiba o nome da skill nem o comando.
