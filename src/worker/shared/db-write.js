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
export async function dbWrite(db, fn, label = 'dbWrite') {
  try {
    return await fn();
  } catch (err) {
    if (!isDbFull(err)) throw err;

    console.warn(`[${label}] DB full, running sync cleanup before retry`);
    await runCleanup(db).catch(e => console.error(`[${label}] cleanup failed:`, e.message));

    try {
      return await fn();
    } catch (retryErr) {
      console.error(`[${label}] retry after cleanup failed:`, retryErr.message);
      return null;
    }
  }
}
