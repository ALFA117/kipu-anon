// Ensayo LOCAL de la corrida final después del incidente. No llama al servicio desplegado ni gasta corridas:
// 1) baja las fuentes nuevas a raw/v2, 2) compara contra la descarga anterior, 3) corre el evaluador local
// estricto sobre ellas, 4) revisa que las personas de antes conserven exactamente su seudónimo.
// uso: node scripts/post-incident.js
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fetchSources, diffIndex } from '../src/sources.js';
import { runPipeline } from '../src/pipeline.js';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const dest = 'raw/v2';
fs.rmSync(dest, { recursive: true, force: true });
console.log('1. bajando fuentes nuevas…');
await fetchSources(env.FUENTES_API, env.FUENTES_TOKEN, dest, console.log);
console.log('2. cambio respecto a la descarga anterior:', JSON.stringify(await diffIndex('raw/full/record_index.json', `${dest}/record_index.json`)));

// 3. pipeline con el mapa persistido (copia) y comparación de seudónimos viejos
const before = JSON.parse(fs.readFileSync('data/pseudonyms.json', 'utf8'));
fs.copyFileSync('data/pseudonyms.json', 'evals/pseudonyms.v2.tmp.json');
const r = runPipeline({ srcDir: dest, outDir: 'evals/out_v2', storedFile: 'evals/pseudonyms.v2.tmp.json' });
const after = JSON.parse(fs.readFileSync('evals/pseudonyms.v2.tmp.json', 'utf8'));
const keys = Object.keys(before);
const same = keys.filter(k => after[k] && JSON.stringify(after[k].first) === JSON.stringify(before[k].first) && after[k].surnames[0] === before[k].surnames[0]);
console.log(`3. personas de antes con el mismo seudónimo: ${same.length}/${keys.length} · personas nuevas: ${Object.keys(after).length - keys.length} · registros: ${r.chats.length} chats, ${r.docs.length} docs, ${r.tables.length} filas`);
fs.rmSync('evals/pseudonyms.v2.tmp.json', { force: true });

// 4. evaluador local estricto sobre las fuentes nuevas
console.log('4. evaluador local estricto sobre las fuentes nuevas…');
execFileSync(process.execPath, ['scripts/eval-local.js', '--src', dest, '--nota', 'ensayo post-incidente (fuentes nuevas)'], { stdio: 'inherit' });
