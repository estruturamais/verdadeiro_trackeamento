import { runCleanup } from './cleanup.js';

// Strings conhecidas que indicam DB cheio no Cloudflare D1
const DB_FULL_PATTERNS = ['maximum DB size', 'SQLITE_FULL', 'D1_ERROR', 'no more space'];

function isDbFull(err) {
  const msg = err?.message || '';
  return DB_FULL_PATTERNS.some(p => msg.includes(p));
}

// Executa fn(). Se falhar com DB cheio: cleanup sincrono + retry uma vez.
// Erros que nao sao DB cheio (schema, bind, etc.) sao re-lancados para o caller.
// Falha no retry: loga e retorna null — nunca lanca, nunca bloqueia o dispatch.
//
// `env` e opcional. Quando passado, a limpeza de emergencia respeita a politica de retencao
// (em keep_all+halt_writes ela NAO roda → a escrita falha de proposito). Quando ausente
// (ex.: chamadas do logger), a limpeza de emergencia e PULADA — conservador: nunca apaga
// historico silenciosamente sem conhecer a politica.
export async function dbWrite(db, fn, label = 'dbWrite', env = null) {
  try {
    return await fn();
  } catch (err) {
    if (!isDbFull(err)) throw err;

    if (env) {
      console.warn(`[${label}] DB full, running sync cleanup before retry`);
      await runCleanup(db, env, { force: true })
        .catch(e => console.error(`[${label}] cleanup failed:`, e.message));
    } else {
      console.warn(`[${label}] DB full, sem env — pulando cleanup de emergencia`);
    }

    try {
      return await fn();
    } catch (retryErr) {
      console.error(`[${label}] retry after cleanup failed:`, retryErr.message);
      return null;
    }
  }
}
