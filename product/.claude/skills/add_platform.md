# Skill: add_platform — Adicionar Plataforma ao Tracking Existente

## Papel

Adiciona uma nova plataforma de anuncios (Meta Ads, TikTok Ads, GA4, Google Ads, Sheets) a um Verdadeiro Trackeamento ja implantado e funcionando na Cloudflare.

Nao refaz Steps 0-2 do workflow principal — parte do pressuposto que a infraestrutura esta ativa e o tracking esta funcionando. Carrega a skill especializada da plataforma para guiar a coleta de credenciais.

---

## Passo 1 — Confirmar plataforma e conta Cloudflare

Se a plataforma nao foi especificada no slash command, perguntar:

> "Qual plataforma voce quer adicionar?
>
> **A** — Meta Ads (Facebook / Instagram Ads)
> **B** — TikTok Ads
> **C** — Google Analytics 4 (GA4)
> **D** — Google Ads
> **E** — Google Sheets (salvar leads automaticamente em planilha)"

Apos confirmar a plataforma:
1. Carregar a skill especializada correspondente:
   - Meta Ads → `.claude/skills/meta.md`
   - TikTok Ads → `.claude/skills/tiktok.md`
   - GA4 → `.claude/skills/ga4.md`
   - Google Ads → `.claude/skills/google_ads.md`
   - Sheets → `.claude/skills/planilha.md`

2. REGRA BLOQUEANTE — confirmar conta Cloudflare antes de qualquer acao:
   - Executar `npx wrangler whoami`
   - Exibir resultado completo
   - Perguntar: "Esta e a conta Cloudflare correta para este projeto? Confirma com S ou N."
   - Aguardar S antes de continuar. Se N: orientar `wrangler logout` → `wrangler login` → repetir `wrangler whoami`.

3. Ler `wrangler.toml` para confirmar o `site_id` e o `SITE_CONFIG` atual antes de modificar.

---

## Passo 2 — Coletar credenciais da nova plataforma

Delegar completamente para a skill especializada da plataforma confirmada.

Seguir o mesmo procedimento do Step 3 do workflow principal:
- Coletar IDs e tokens conforme instrucoes da skill especializada
- Campos que vao para o config JSON: coletar e preparar para integracao
- Secrets (access tokens, api secrets): executar `npx wrangler secret put {SECRET_NAME}` automaticamente apos coleta (sem pedir aprovacao — apenas exibir o resultado)

---

## Passo 3 — Atualizar SITE_CONFIG no wrangler.toml

1. Ler o `wrangler.toml` atual
2. Localizar o campo `SITE_CONFIG` na secao `[vars]`
3. Parsear o JSON existente
4. Adicionar o bloco de configuracao da nova plataforma ao JSON (seguindo o formato da skill especializada)
5. Serializar o JSON atualizado e substituir o valor de `SITE_CONFIG` no `wrangler.toml`
6. Mostrar o diff do que foi alterado para confirmacao visual

---

## Passo 4 — Deploy

Executar automaticamente (conta ja foi confirmada no Passo 1):

```bash
npx wrangler deploy
```

Verificar que o deploy foi bem-sucedido:

```bash
curl -s https://{dominio}/tracking/web.js | head -c 500
```

Confirmar que `__CONFIG__` na resposta contem os novos campos da plataforma adicionada.

---

## Passo 5 — Validar

Solicitar ao cliente que acesse `{dominio}?debug=1` e abra o console do navegador para confirmar que o script esta carregando normalmente.

Em seguida, instruir a realizar um evento de teste (ex: acessar uma pagina, preencher formulario, ou simular uma compra de teste).

Apos o teste, consultar D1:

```bash
npx wrangler d1 execute tracking_db --remote --command "SELECT platform, event_name, status_code, error_message FROM events WHERE site_id = '{site_id}' ORDER BY id DESC LIMIT 15;"
```

Criterios de sucesso:
- `status_code` 200 (ou 204 para GA4) para a nova plataforma
- `error_message` nulo

Delegar validacao visual para a skill especializada da plataforma:
- Meta Ads → Events Manager > Testar Eventos
- TikTok Ads → Events Manager > Atividade Recente
- GA4 → Admin > DebugView
- Google Ads → Google Tag Assistant (ou painel com delay de ate 3h)
- Sheets → verificar linha inserida na planilha + D1 `platform = 'sheets'` com `status_code: 200`

---

## Regra de automacao

Todos os comandos de terminal executam automaticamente apos a confirmacao de conta no Passo 1.
Nunca pedir aprovacao de comandos tecnicos — executar → exibir resultado → continuar.

---

## Arquitetura de referencia

```
add_platform.md (este arquivo — condutor)
     |
     +-- .claude/skills/meta.md        (se Meta Ads)
     +-- .claude/skills/tiktok.md      (se TikTok Ads)
     +-- .claude/skills/ga4.md         (se GA4)
     +-- .claude/skills/google_ads.md  (se Google Ads)
     +-- .claude/skills/planilha.md    (se Sheets)
```
