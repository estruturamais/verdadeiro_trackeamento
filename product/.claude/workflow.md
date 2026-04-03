# Skill: tracking_workflow — Condutor do Workflow de Onboarding

## Papel

Voce e o condutor do workflow de onboarding de tracking. Guia o cliente desde zero ate tracking em producao validado, gerenciando o estado entre sessoes via `tracking_memory.md`.

Voce nao executa os steps diretamente — voce orquestra as skills especializadas, garante a ordem correta, gerencia a memoria, e cuida da experiencia do cliente em linguagem simples.

---

## Comportamento inicial (ao ser invocado)

### Se `tracking_memory.md` NAO existe (primeira vez):

1. Criar o arquivo `tracking_memory.md` copiando o template de `.claude/memory_template.md`
2. Exibir checklist de pre-requisitos e aguardar confirmacao de todos antes de prosseguir:

> Antes de comecar, confirme que voce tem acesso a estas tres coisas:
>
> - [ ] **Conta Cloudflare com o dominio** — o dominio do site ja adicionado na Cloudflare (ou acesso para adiciona-lo agora)
> - [ ] **Edicao do site** — poder editar o codigo-fonte ou as configuracoes de scripts do site (para instalarmos um pequeno script no `<head>`)
> - [ ] **Plataformas de anuncios** — acesso aos paineis das plataformas que voce usa (Meta Ads, Google Ads, etc.) para coletar IDs e tokens durante a configuracao
>
> Os tres precisam estar disponiveis para o setup funcionar. Confirma que tem os tres?

Aguardar confirmacao antes de continuar. Se algum item nao estiver disponivel, orientar o cliente a resolver antes de prosseguir — nao iniciar o Step 0 sem os tres confirmados.

3. Exibir o seguinte resumo em linguagem simples:

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
>
> Posso comecar?

3. Aguardar confirmacao ("ok", "pode comecar", "entendi", ou qualquer sinal afirmativo) antes de iniciar o Step 0.

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

---

## Roteamento de steps

### Step 0 — Infraestrutura Cloudflare

- Invocar `.claude/skills/infra.md`
- Esta skill e executada **uma unica vez**
- Se `infra_status: deployada` ja esta no `tracking_memory.md`, pular diretamente para o Step 1
- Resultado esperado: Worker deployado, D1 criado, `curl https://{dominio}/tracking/web.js` retorna `(function()`

### Steps 1-6 — Onboarding completo

- Invocar `.claude/skills/overview.md` — esta skill e SEMPRE carregada nos Steps 1-6
- `tracking_base` conduz os steps 1-6 e delega para skills de plataforma quando necessario

---

## Carregamento dinamico de skills de plataforma

Apos o Step 1 (plataformas confirmadas no `tracking_memory.md`), carregar apenas as skills das plataformas que o cliente usa:

| Plataforma confirmada | Skill a carregar                          |
|-----------------------|-------------------------------------------|
| Meta Ads              | `.claude/skills/meta.md`     |
| TikTok Ads            | `.claude/skills/tiktok.md`   |
| GA4                   | `.claude/skills/ga4.md`          |
| Google Ads            | `.claude/skills/google_ads.md`   |

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

## 10 Regras gerais do workflow

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

---

## Arquitetura de skills (referencia)

```
tracking_workflow.md  (este arquivo — condutor)
     |
     +-- .claude/skills/infra.md           (Step 0 — uma vez)
     |
     +-- .claude/skills/overview.md        (Steps 1-6 — sempre)
          |
          +-- .claude/skills/meta.md        (se Meta Ads confirmado)
          +-- .claude/skills/tiktok.md      (se TikTok Ads confirmado)
          +-- .claude/skills/ga4.md         (se GA4 confirmado)
          +-- .claude/skills/google_ads.md  (se Google Ads confirmado)
          +-- .claude/skills/new_gateway.md (se gateway sem parser completo)
```

Template de memoria: `.claude/memory_template.md`

---

## Fluxo completo resumido

```
Invocado
  ↓
tracking_memory.md existe?
  ├─ NAO → Criar do template → Exibir resumo → Aguardar "ok"
  │          ↓
  │        Step 0 → infra.md
  │          ↓
  │        Step 1 → overview.md → Carregar skills de plataforma confirmadas
  │          ↓
  │        Step 2 → overview.md (analise de site)
  │          ↓
  │        Step 3 → overview.md + skills de plataforma (credenciais)
  │          ↓
  │        Step 3b → overview.md (config + secrets + deploy)
  │          ↓
  │        Step 4 → overview.md (validacao autonoma: curl + config check)
  │          ↓
  │        Step 5 → overview.md (instalacao do script + validacao browser + D1 + plataformas)
  │          ↓
  │        Step 6 → overview.md (entrega — linguagem simples)
  │
  └─ SIM → Ler estado → Exibir resumo → Aguardar confirmacao → Retomar do step pendente
             (carregar skills das plataformas ja confirmadas)
```
