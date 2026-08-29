# Site servido por plataforma SaaS (Lovable, Vercel, Netlify, Framer, Webflow…)

> **REGRA BLOQUEANTE — NUNCA ligar o proxy da Cloudflare (nuvem laranja) num host
> servido por plataforma SaaS.** Nem no apex, nem no subdomínio do app, nem no
> domínio próprio do checkout. O tracking vive **só** num subdomínio dedicado.
>
> Esta regra **revoga** qualquer recomendação anterior em sentido contrário, deste
> repositório ou de conversas passadas.

## O que aconteceu (produção, 2026-08)

Num cliente cujo site é servido pela Lovable, as Worker Routes no apex **nunca eram
invocadas**: `wrangler tail` conectava e mostrava **zero invocações**, com as rotas
registradas e a zona ativa. A causa é real e não é bug da Cloudflare — o apex é
servido por um **custom hostname da plataforma**, com certificado de SAN único (não o
wildcard do Universal SSL), então o request **não é processado na zona do cliente**.

A conclusão natural — *"basta ligar o proxy no apex e pôr o SSL/TLS em Full"* — foi
seguida. **E derrubou o site em produção.**

## Por que a validação imediata não vale como prova

Este é o ponto que faz a armadilha funcionar: **logo após ligar o proxy, tudo passou.**
O apex devolveu **HTTP 200 com a página real**, sem Error 1000, sem 525, sem 526, com
MX e DKIM intactos. Ficou registrado como *"validado, sem quebra"*.

**Caiu depois assim mesmo.**

O cenário Cloudflare-na-frente-de-Cloudflare com custom hostname **sobrevive ao teste
do minuto seguinte e quebra adiante**, quando qualquer um destes acontece:

- reemissão ou renovação do certificado do custom hostname na plataforma;
- mudança de roteamento interno da plataforma (deploy, migração de edge);
- expiração do cache que ainda estava servindo a resposta boa.

> **Um `200` imediato depois de ligar o proxy é um falso negativo, não uma aprovação.**
> Não existe teste de minuto que valide esta configuração. A única resposta correta é
> não ligar.

## A topologia correta

O tracking vive num subdomínio **dedicado**, que **não existe para a plataforma** —
por isso ele pode ser laranja sem disputar nada com ninguém:

```
apex        {dominio}                 -> CINZA   (a plataforma serve o app)
app         app.{dominio}             -> CINZA   (plataforma)
checkout    checkout.{dominio}        -> CINZA   (gateway)
TRACKING    track.{dominio}           -> LARANJA (AAAA 100::)   <-- o ÚNICO
```

Todas as Worker Routes ficam em `track.{dominio}/*`. O registro `AAAA 100::` é o
endereço-sumidouro padrão: não há origem por trás, o Worker responde antes.

## Se o proxy já estiver ligado e houver instabilidade

**Voltar para nuvem cinza é a PRIMEIRA ação** — antes de investigar SSL/TLS, antes de
olhar Page Rules, antes de abrir ticket. Só depois de o site voltar é que se
diagnostica o resto. Investigar com o site fora do ar troca minutos de indisponibilidade
por informação que o rollback também daria.

## Consequência para o `collect_url`

Com o tracking num subdomínio dedicado, o beacon **precisa** apontar para lá em URL
**absoluta** (`https://track.{dominio}/collect/event`). Relativo, ele vai para o host da
plataforma — que **não tem Worker Route** — e `navigator.sendBeacon` **não reporta
erro**: a coleta morre em silêncio, com o site aparentemente saudável.

> ⚠️ **Estado atual do repositório:** `collect_url` ainda é fixo em
> `'/collect/event'` (`src/worker/routes/serve-webjs.js`). Torná-lo configurável é o
> item **`RDOM-4`**, ainda pendente. Enquanto ele não entrar, um cliente nesta
> topologia exige o script servido pelo mesmo host do beacon — confirme a coleta pelo
> D1 (`SELECT COUNT(*) FROM events WHERE platform='collect'`) antes de dar a
> implantação por entregue. **Nunca** conclua que a coleta funciona só porque o site
> carrega o script.

## Checklist para o agente

- [ ] O site é servido por plataforma SaaS? (Lovable, Vercel, Netlify, Framer, Webflow,
      Bubble, Softr…) → **nenhum host da plataforma pode ficar laranja**
- [ ] Existe `track.{dominio}` com `AAAA 100::` **proxiado**?
- [ ] Todas as Worker Routes estão em `track.{dominio}/*`?
- [ ] O apex, o app e o checkout estão **cinza**?
- [ ] A coleta foi confirmada **no D1**, não pela ausência de erro no navegador?

## Sintoma → causa → o que fazer

| Sintoma | Causa provável | Ação |
|---|---|---|
| `wrangler tail` conecta e mostra **zero invocações**, com rotas registradas | o host é servido por custom hostname da plataforma; o request não entra na zona | mover o tracking para `track.{dominio}` — **não** ligar o proxy no host atual |
| Site fora do ar depois de ligar o proxy (Error 1000/525/526 **ou nada**) | Cloudflare na frente de Cloudflare com custom hostname | **voltar para cinza imediatamente**, depois investigar |
| Ligou o proxy, testou e "ficou 200" | falso negativo — quebra na próxima reemissão de certificado | voltar para cinza mesmo assim; o teste não prova nada aqui |
| Site OK, script carrega, mas `events` vazio no D1 | beacon indo para o host da plataforma (sem Worker Route); `sendBeacon` não reporta erro | conferir o host do `collect_url`; ver `RDOM-4` |
