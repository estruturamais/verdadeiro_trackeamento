// Retencao dos dados no D1. Politica lida do SITE_CONFIG (fonte da verdade):
//
//   "retention": {
//     "mode": "auto_clean" | "keep_all",        // default: auto_clean
//     "when_full": "halt_writes" | "recycle_oldest"  // so vale em keep_all; default: recycle_oldest
//   }
//
// - auto_clean (default): limpeza por janela roda normalmente (grátis, sem historico longo).
// - keep_all: a limpeza de rotina NAO roda (dados persistem; exige pagar a Cloudflare).
//     - when_full=halt_writes: nem a limpeza de emergencia (DB cheio) roda → as escritas falham
//       (o tracking para — incentivo a pagar).
//     - when_full=recycle_oldest: so a limpeza de emergencia roda, reciclando o lote mais antigo
//       para o tracking nao travar.
//
// O catch de DB-cheio (index.js) e o retry do db-write.js chamam com { force: true }.
// Ver .claude/references/utm-convention.md (vizinho) e o workflow (pergunta opt-in do analistA+).

function getRetention(env) {
  try {
    const cfg = typeof env?.SITE_CONFIG === 'string'
      ? JSON.parse(env.SITE_CONFIG)
      : (env?.SITE_CONFIG || {});
    const r = cfg.retention || {};
    return {
      mode: r.mode === 'keep_all' ? 'keep_all' : 'auto_clean',
      when_full: r.when_full === 'halt_writes' ? 'halt_writes' : 'recycle_oldest'
    };
  } catch (e) {
    return { mode: 'auto_clean', when_full: 'recycle_oldest' };
  }
}

export async function runCleanup(db, env, opts = {}) {
  const { mode, when_full } = getRetention(env);
  const force = opts.force === true;

  if (mode === 'keep_all') {
    // Rotina nunca limpa em keep_all. Emergencia (force) so limpa se recycle_oldest.
    if (!force || when_full === 'halt_writes') return;
  }

  // ATENCAO: a tabela `subscriptions` (SaaS) esta FORA desta lista DE PROPOSITO e
  // NAO deve ser adicionada. Ela nao tem retencao: e o historico que distingue a
  // aquisicao de um cliente novo da renovacao de um assinante antigo. Apagar uma
  // linha faz o assinante correspondente voltar a ser contado como CLIENTE NOVO na
  // proxima cobranca — inflando a aquisicao e destruindo o CAC do relatorio, sem
  // nenhum erro visivel. A lista abaixo e uma allowlist, nao um esquecimento.
  await db.batch([
    db.prepare("DELETE FROM events WHERE timestamp < datetime('now', '-7 days')"),
    db.prepare("DELETE FROM webhook_raw WHERE timestamp < datetime('now', '-14 days')"),
    db.prepare("DELETE FROM user_store WHERE updated_at < datetime('now', '-90 days')")
  ]);
}
