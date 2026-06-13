// Gera src/web-template.txt a partir de src/web.js (copia multiplataforma).
//
// O Worker importa o script de tracking como modulo de texto (.txt), entao
// precisa de uma copia .txt do web.js. Este script mantem as duas em sincronia.
//
// Executado automaticamente pelo wrangler via [build].command (wrangler.toml)
// antes de TODO `wrangler deploy` e `wrangler dev` — independente de ser
// chamado por `npx wrangler deploy` ou `npm run deploy`. Usa Node puro
// (fs.copyFileSync), entao funciona identico em Windows, macOS e Linux.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(root, 'src', 'web.js'), join(root, 'src', 'web-template.txt'));
console.log('[build] web-template.txt sincronizado a partir de web.js');
