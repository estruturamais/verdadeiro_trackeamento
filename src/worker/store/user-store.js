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
