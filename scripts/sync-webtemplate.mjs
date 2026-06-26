// Gera src/web-template.txt a partir de src/web.js, prefixando um banner com a
// versao (lida de package.json) e o credito ao criador.
//
// O Worker importa o script de tracking como modulo de texto (.txt), entao
// precisa de uma copia .txt do web.js. Este script mantem as duas em sincronia
// e carimba a versao para que ela viaje no script servido — visivel via
// `curl https://{dominio}/tracking/web.js` (1a linha) mesmo sem arquivos locais.
//
// Executado automaticamente pelo wrangler via [build].command (wrangler.toml) e
// pelos scripts npm (prebuild/dev/deploy) antes de TODO deploy. Usa Node puro,
// entao funciona identico em Windows, macOS e Linux.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const webJs = readFileSync(join(root, 'src', 'web.js'), 'utf8');

// Banner em comentario de bloco: a URL nao contem a sequencia "*/", entao nao
// fecha o comentario antes da hora. Separadores ASCII para evitar qualquer risco
// de encoding no pipeline de build/serve.
const banner = '/*! Verdadeiro Trackeamento v' + pkg.version +
  ' | criado por @estruturamais | https://instagram.com/estruturamais */\n';

writeFileSync(join(root, 'src', 'web-template.txt'), banner + webJs);
console.log('[build] web-template.txt sincronizado a partir de web.js (v' + pkg.version + ')');
