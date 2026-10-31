// Corrida de evaluación LOCAL: no gasta corridas oficiales. Junta todos los revisores, calcula una nota
// aproximada y guarda el resultado en evals/historial.jsonl para comparar versiones (automejora).
//
// uso: node scripts/eval-local.js [--src raw/full] [--nota "qué cambié"] [--auditor]
//      node scripts/eval-local.js --tabla            (solo muestra el historial)
//      node scripts/eval-local.js --oficial 94/118 --set 75 --nota "corrida 2"   (anota una corrida oficial)
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { runPipeline } from '../src/pipeline.js';
import { anonymizeBatch } from '../src/live.js';
import { runLiveCases } from './live-test.js';
import { consistency } from './consistency.js';
import { hardChecks } from './hard-checks.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const HIST = 'evals/historial.jsonl';
fs.mkdirSync('evals', { recursive: true });

const readHist = () => (fs.existsSync(HIST) ? fs.readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const commit = () => {
  try {
    const h = execSync('git rev-parse --short HEAD').toString().trim();
    const dirty = execSync('git status --porcelain -- src').toString().trim() ? '+cambios' : '';
    return h + dirty;
  } catch { return '?'; }
};
const hora = () => new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

function tabla() {
  const rows = readHist();
  const head = '| # | hora | tipo | commit | **nota estricta** | fuga /45 | utilidad /35 | consist. /20 | formas fugadas | públicos | muestra | en vivo | homónimos | estables | nota de cambio |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r, i) => r.tipo === 'oficial'
    ? `| ${i + 1} | ${r.hora} | **oficial** | ${r.commit} | **${r.oficial}** (${r.set} % del set) | | | | | | | | | | ${r.nota_cambio || ''} |`
    : r.fuga === undefined
      ? `| ${i + 1} | ${r.hora} | local v1 | ${r.commit} | (v1: ${r.nota}) | | | | ${r.fugas} | ${r.publicos} | ${r.muestra} | ${r.envivo} | | ${r.estables} | ${r.nota_cambio || ''} |`
      : `| ${i + 1} | ${r.hora} | local | ${r.commit} | **${r.nota}** | ${r.fuga} | ${r.utilidad} | ${r.consist} | ${r.formas_fugadas}/${r.formas_revisadas} | ${r.publicos} | ${r.muestra} | ${r.envivo} | ${r.homonimos || ''} | ${r.estables} | ${r.nota_cambio || ''} |`);
  const md = ['# Historial de corridas', '', 'La nota estricta imita la rúbrica (fuga 45 · utilidad 35 · consistencia 20) con métricas más duras que los tests públicos: 2.945 formas reales por buscar (usuarios en links, @handles, fechas en palabras, placas, cuentas), parecido del texto, categoría de los seudónimos, homónimos sin cruzarse, «reporta a» y honestidad del diccionario. El detalle de la última corrida está en evals/ultimo-detalle.json. La nota oficial la da el set oculto de Frontier.', '', head, sep, ...lines, ''].join('\n');
  fs.writeFileSync('evals/HISTORIAL.md', md);
  console.log([head, sep, ...lines].join('\n'));
}

if (has('--tabla')) { tabla(); process.exit(0); }

if (has('--oficial')) {
  fs.appendFileSync(HIST, JSON.stringify({ tipo: 'oficial', hora: hora(), commit: commit(), oficial: arg('--oficial'), set: arg('--set', '?'), nota_cambio: arg('--nota', '') }) + '\n');
  tabla();
  process.exit(0);
}

const src = arg('--src', 'raw/full');
const out = 'evals/out';
const t0 = Date.now();

// 1. pipeline completo, sin tocar el mapa persistido (se usa una copia)
fs.rmSync(out, { recursive: true, force: true });
const storedCopy = 'evals/pseudonyms.tmp.json';
if (fs.existsSync('data/pseudonyms.json')) fs.copyFileSync('data/pseudonyms.json', storedCopy); else fs.rmSync(storedCopy, { force: true });
const r = runPipeline({ srcDir: src, outDir: out, storedFile: storedCopy });
const segundos = (Date.now() - t0) / 1000;

// 2. validador oficial
const idx = fs.existsSync(path.join(src, 'record_index.json')) ? src : 'data';
const val = spawnSync(process.execPath, ['scripts/validar.mjs', out, '--public', idx], { encoding: 'utf8' });
const validador = /OK: la salida pasa el validador/.test(val.stdout);

// 3. barrido de fuga + tests públicos (si están) con la normalización del juez
const pub = fs.existsSync('fuentes/tests_public.json') ? ['fuentes/tests_public.json'] : [];
const chk = spawnSync(process.execPath, ['scripts/check.js', src, out, ...pub], { encoding: 'utf8' });
const fugas = +(chk.stdout.match(/· (\d+) con fuga/) || [0, -1])[1];
const publicos = (chk.stdout.match(/tests: (\d+\/\d+)/) || [0, 'n/a'])[1];

// 4. tests de la muestra (pipeline sobre sample/input)
let muestra = 'n/a';
if (fs.existsSync('raw/sample/input')) {
  runPipeline({ srcDir: 'raw/sample/input', outDir: 'evals/out_sample', storedFile: null });
  const s = spawnSync(process.execPath, ['scripts/check.js', 'raw/sample/input', 'evals/out_sample', 'raw/sample/tests_sample.json'], { encoding: 'utf8' });
  muestra = (s.stdout.match(/tests: (\d+\/\d+)/) || [0, '?'])[1];
}

// 5. pruebas en vivo en proceso (mismo estado que dejó la corrida)
const state = { reg: r.reg, an: r.an, threads: r.threads };
const caller = async (source, records) => {
  const t = Date.now();
  if (!['chats', 'docs', 'tables'].includes(source)) return { status: 422, ms: 0, json: null };
  try { const json = anonymizeBatch(state, source, records); return { status: 200, ms: Date.now() - t, json }; }
  catch (e) { return { status: 500, ms: Date.now() - t, json: null, body: String(e) }; }
};
const live = await runLiveCases(caller, out, path.join(src, 'tables/clientes.csv'), true);

// 6. consistencia: unicidad de seudónimos y estabilidad contra el mapa persistido
const ents = JSON.parse(fs.readFileSync(path.join(out, 'entities.json'), 'utf8')).entities.filter(e => !e.kept);
const names = ents.map(e => e.pseudonyms?.name).filter(Boolean);
const unicidad = names.length ? new Set(names).size / names.length : 1;
let estables = 'n/a', stablePct = 1;
if (fs.existsSync('data/pseudonyms.json')) {
  const a = JSON.parse(fs.readFileSync('data/pseudonyms.json', 'utf8'));
  const b = JSON.parse(fs.readFileSync(storedCopy, 'utf8'));
  const keys = Object.keys(a);
  const same = keys.filter(k => b[k] && JSON.stringify(a[k].first) === JSON.stringify(b[k].first) && a[k].surnames[0] === b[k].surnames[0]).length;
  estables = `${same}/${keys.length}`;
  stablePct = keys.length ? same / keys.length : 1;
}

// 6b. consistencia por persona (registros de la entrada vs. entidad y seudónimo en la salida)
const cons = consistency(src, out);

// 7. auditor con IA (opcional, gasta unos centavos)
let auditor = null;
if (has('--auditor')) {
  const a = spawnSync('python', ['-I', 'auditor/auditor.py', out, src], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  auditor = (a.stdout.match(/confirmados contra la entrada: (\d+)/) || [0, '?'])[1];
}

// métricas estrictas con la forma de la rúbrica (versión 2 del evaluador)
const hard = hardChecks(src, out);
fs.writeFileSync('evals/ultimo-detalle.json', JSON.stringify(hard, null, 1));

// nota local v1 (la de antes, para comparar): fuga 45 · utilidad 35 · consistencia 20
const ratio = s => { const m = String(s).match(/(\d+)\/(\d+)/); return m ? +m[1] / +m[2] : 1; };
const fugaPts = validador ? 45 * Math.max(0, 1 - Math.max(0, fugas) / 20) : 0;
const utilPts = 35 * ((ratio(publicos) + ratio(muestra)) / 2);
const consPts = 20 * ((live.ok / live.total) * 0.4 + (cons.ok / cons.total) * 0.6) * unicidad * stablePct;
const nota = Math.round((fugaPts + utilPts + consPts) * 10) / 10;

const row = {
  tipo: 'local', hora: hora(), commit: commit(), nota: hard.nota, nota_v1: nota, fuga: hard.fuga.pts, utilidad: hard.utilidad.pts, consist: hard.consistencia.pts,
  formas_fugadas: hard.fuga.fugadas, formas_revisadas: hard.fuga.formas, validador, fugas, publicos, muestra,
  envivo: `${live.ok}/${live.total}`, fallos_envivo: live.fails, consistencia: `${cons.ok}/${cons.total}`, fallos_consistencia: cons.fallas.map(f => f.id), homonimos: hard.consistencia.homonimos, detalle: { utilidad: hard.utilidad, consistencia: { ...hard.consistencia, fallas_persona: undefined } }, ejemplos_fuga: hard.fuga.ejemplos.map(x => x.tipo), personas: ents.length,
  unicidad: Math.round(unicidad * 1000) / 1000, estables, segundos, auditor, nota_cambio: arg('--nota', ''),
};
fs.appendFileSync(HIST, JSON.stringify(row) + '\n');
fs.rmSync(storedCopy, { force: true });
if (!validador) console.log(val.stdout);
if (live.fails.length) console.log('fallos en vivo:', live.fails.join(' · '));
tabla();
