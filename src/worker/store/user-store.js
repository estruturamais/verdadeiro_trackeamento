// As colunas de click id (gclid/wbraid/gbraid) chegaram na 1.6.0, pela migration
// `migrations/003_add_gclid_columns.sql`. Uma instalacao que atualizou o codigo e
// ainda NAO rodou a migration nao as tem — e o INSERT falharia com
// `table user_store has no column named gclid`.
//
// POR QUE ISSO NAO PODE SER "basta rodar a migration": o erro do D1 vem prefixado
// com `D1_ERROR`, que o `dbWrite` classifica como banco cheio. Ele dispararia um
// cleanup destrutivo a cada beacon, tentaria de novo, falharia e devolveria null
// SEM lancar. Resultado: `user_store` nunca gravado, nenhum erro visivel no D1 e o
// log do beacon ainda em 200 — atribuicao morta com o painel verde. Esquecer a
// migration nao pode custar isso.
//
// Entao o upsert se adapta: tenta o statement completo e, se o banco disser que a
// coluna nao existe, marca a capacidade como ausente no escopo do modulo e refaz
// sem os click ids. Um isolate paga o erro uma vez; depois da migration, um
// isolate novo volta sozinho ao caminho completo. A migration passa a ser o que
// HABILITA o gclid, nao o que evita o desastre.
let _temColunasClickId = true;

const COLUNAS_BASE = [
  'marca_user', 'ip', 'user_agent', 'fbp', 'fbc', 'ttp', 'ttclid',
  'ga_client_id', 'ga_session_id', 'ga_session_count', 'ga_timestamp'
];
const COLUNAS_CLICK_ID = ['gclid', 'wbraid', 'gbraid'];
const COLUNAS_FIM = [
  'page_url', 'email', 'phone', 'fullname', 'city', 'state', 'country', 'zip'
];

function colunasDe(comClickIds) {
  return comClickIds
    ? [...COLUNAS_BASE, ...COLUNAS_CLICK_ID, ...COLUNAS_FIM]
    : [...COLUNAS_BASE, ...COLUNAS_FIM];
}

function montarSql(comClickIds) {
  const cols = colunasDe(comClickIds);
  const placeholders = cols.map((_, i) => `?${i + 1}`).join(', ');
  // `marca_user` e a PK. COALESCE(NULLIF(...)) preserva o valor ja gravado quando
  // o beacon novo vem vazio: o PRIMEIRO nao-vazio gruda.
  const sets = cols.slice(1)
    .map((c) => `      ${c.padEnd(16)} = COALESCE(NULLIF(excluded.${c}, ''), user_store.${c})`)
    .join(',\n');

  return `
    INSERT INTO user_store (${cols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(marca_user) DO UPDATE SET
      updated_at       = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
${sets}
  `;
}

const SQL_COM_CLICK_ID = montarSql(true);
const SQL_SEM_CLICK_ID = montarSql(false);

function colunaDeClickIdAusente(err) {
  const msg = String(err?.message || '');
  return COLUNAS_CLICK_ID.some(
    (c) => msg.includes(`no column named ${c}`) || msg.includes(`no such column: ${c}`)
  );
}

function executar(db, data, comClickIds) {
  const valores = colunasDe(comClickIds).map((c) =>
    c === 'marca_user' ? data.marca_user : (data[c] || '')
  );
  return db.prepare(comClickIds ? SQL_COM_CLICK_ID : SQL_SEM_CLICK_ID)
    .bind(...valores)
    .run();
}

export async function upsertUserStore(db, data) {
  if (_temColunasClickId) {
    try {
      return await executar(db, data, true);
    } catch (err) {
      if (!colunaDeClickIdAusente(err)) throw err;
      _temColunasClickId = false;
      console.warn(
        '[user_store] colunas de click id ausentes — o tracking segue normal, mas o gclid nao ' +
        'esta sendo guardado (sem ele a conversao offline do Google Ads perde a atribuicao por ' +
        'clique). Rode: wrangler d1 execute tracking_db --file=./migrations/003_add_gclid_columns.sql --remote'
      );
    }
  }
  return executar(db, data, false);
}

export async function getUserStore(db, marcaUser) {
  return db.prepare('SELECT * FROM user_store WHERE marca_user = ?').bind(marcaUser).first();
}

// Fallback do FDV merge quando o webhook NAO traz o indexador (`marca_user`):
// compra organica/digitada, checkout proprio, e — sempre — a renovacao de
// assinatura, que e 100% server-side e nunca passa por um navegador. Sem isto o
// evento sai sem fbp/fbc/gclid/IP/UA, ou seja, sem atribuicao nenhuma.
//
// Casa pela linha MAIS RECENTE do mesmo e-mail: num SaaS o proprio login do app
// renova essa linha todo dia, entao ela e a sessao mais util que existe.
// Medido em producao: 2 de 90 webhooks traziam o indexador, e ainda assim 21
// conversoes sairam com identidade — 19 recuperadas por aqui.
//
// COLLATE NOCASE cobre a base gravada antes da normalizacao. O indice de apoio
// (idx_user_store_email) vem do schema.sql / migrations/005; sem ele a query ainda
// funciona, so que com full scan.
export async function getUserStoreByEmail(db, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return db.prepare(
    'SELECT * FROM user_store WHERE email = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1'
  ).bind(normalized).first();
}

// Fallback do FDV merge por IP DO DISPOSITIVO — o que sobra quando o webhook nao traz o
// indexador E o comprador nunca digitou o e-mail no site. Quem abandona o checkout e volta
// por um link SEM parametros (recuperacao de carrinho, link reaberto) chega com `sck` e UTMs
// nulos, embora o D1 tenha o fbp/fbc/ga_client_id da visita: sem isto, a venda sai sem nenhum.
//
// Premissa verificada: o `Customer.ip` da Kiwify e o IP do aparelho do comprador (casou com
// o IP que a Cloudflare viu no beacon). Ela NAO vale para todo gateway — antes de ligar em
// outro, conferir no payload real (tabela "IP do payload = aparelho?" em
// .claude/references/gateway-webhooks.md).
//
// Por que consultar `events` e nao `user_store`: o `user_store.updated_at` sobe a cada evento
// (inclusive os POSTERIORES a venda) e guarda UM ip por visitante; `events` tem o carimbo de
// cada beacon e distingue quem clicou no checkout DENTRO da janela. Sem indice novo: o
// filtro site_id + timestamp usa o idx_events_site_time, e a janela e curta.
//
// Conservador de proposito — IP e compartilhado (CGNAT movel, wifi de casa: outro aparelho pode
// navegar pelo mesmo IP minutos antes ou depois). Por isso: so conta beacon da janela, exige
// `initiate_checkout` por padrao e, havendo mais de um candidato, fica com o clique de
// checkout mais recente. Sem candidato = null: a venda sai como antes, sem identidade
// inventada. Devolve tambem os numeros da decisao para o log do webhook.
export async function getUserStoreByIp(db, siteId, ip, { windowHours = 12, requireCheckout = true } = {}) {
  const normalized = String(ip || '').trim();
  if (!normalized) return null;
  const desde = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  const { results } = await db.prepare(
    `SELECT marca_user,
            SUM(CASE WHEN event_name = 'initiate_checkout' THEN 1 ELSE 0 END) AS checkouts,
            MAX(CASE WHEN event_name = 'initiate_checkout' THEN timestamp END) AS ultimo_checkout,
            MAX(timestamp) AS ultimo_evento
       FROM events
      WHERE site_id = ?1 AND platform = 'collect'
        AND source_ip = ?2 COLLATE NOCASE
        AND marca_user <> '' AND timestamp >= ?3
      GROUP BY marca_user`
  ).bind(siteId, normalized, desde).all();

  const candidatos = (results || []).filter((r) => !requireCheckout || r.checkouts > 0);
  if (!candidatos.length) return null;

  // Quem clicou no checkout vem primeiro; dentro do grupo, o mais recente.
  const recencia = (r) => r.ultimo_checkout || r.ultimo_evento || '';
  candidatos.sort((a, b) =>
    ((b.checkouts > 0) - (a.checkouts > 0)) || recencia(b).localeCompare(recencia(a))
  );
  const escolhido = candidatos[0];

  const store = await getUserStore(db, escolhido.marca_user);
  if (!store) return null;
  return {
    store,
    candidatos: candidatos.length,
    ambiguo: candidatos.length > 1,
    checkouts: escolhido.checkouts,
    ultimo_checkout: escolhido.ultimo_checkout || ''
  };
}
