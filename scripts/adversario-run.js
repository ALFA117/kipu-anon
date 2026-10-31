// Corre los casos del adversario (auditor/adversario.py) por /anonymize en proceso y mide qué se escapa.
// uso: node scripts/adversario-run.js [evals/adversario-casos.json] [--url https://kipu-anon.vercel.app/v1]
import fs from 'node:fs';
import { runPipeline } from '../src/pipeline.js';
import { anonymizeBatch } from '../src/live.js';
import { contiene } from './judge-text.js';

const file = process.argv.slice(2).find(a => a.endsWith('.json')) || 'evals/adversario-casos.json';
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null;
const casos = JSON.parse(fs.readFileSync(file, 'utf8'));
// el adversario a veces marca como "personal" cosas que deben quedarse: ciudades, montos, ids, marcas
const NO_PII = /^(Bogotá|Medellín|Cali|Barranquilla|Bucaramanga|Cartagena|Cúcuta|Manizales|Pasto|Pereira|Ibagué|Santa Marta|Villavicencio|Neiva|Armenia|Montería|Envigado|Itagüí|Colombia)$|^\$|COP|^(TX|PQR|CL|KP|INC|S)-|^\d{1,3}(\.\d{3})+$|^\d+ de \w+ de 20\d\d$/;
for (const c of casos) c.debe_desaparecer = (c.debe_desaparecer || []).filter(x => !NO_PII.test(x.trim()));

let call;
if (url) {
  call = async recs => (await (await fetch(`${url}/anonymize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'chats', records: recs }) })).json()).records;
} else {
  const r = runPipeline({ srcDir: 'raw/full', outDir: null, storedFile: null });
  const state = { reg: r.reg, an: r.an, threads: r.threads };
  call = async recs => anonymizeBatch(state, 'chats', recs).records;
}

let leaks = 0, lost = 0, ok = 0;
const fallas = [];
for (let i = 0; i < casos.length; i += 50) {
  const lote = casos.slice(i, i + 50);
  const out = await call(lote.map((c, k) => ({ id: `adv${i + k}`, thread_id: `adv:${i + k}`, author: '', ts: '1', text: c.texto, attachments: [] })));
  lote.forEach((c, k) => {
    const t = out[k]?.text || '';
    const escaped = c.debe_desaparecer.filter(x => x.length >= 3 && contiene(t, x));
    const broken = c.debe_quedar.filter(x => !t.includes(x));
    leaks += escaped.length; lost += broken.length;
    if (!escaped.length && !broken.length) ok++;
    else fallas.push({ tema: c.tema, texto: c.texto, salida: t, se_escapa: escaped, se_pierde: broken });
  });
}
const total = casos.reduce((s, c) => s + c.debe_desaparecer.length, 0);
console.log(`casos limpios: ${ok}/${casos.length} · datos que se escapan: ${leaks}/${total} · conservados que se pierden: ${lost}`);
const byTema = {};
for (const f of fallas) byTema[f.tema] = (byTema[f.tema] || 0) + 1;
console.log('fallas por tema:', JSON.stringify(byTema, null, 0));
fs.writeFileSync('evals/adversario-fallas.json', JSON.stringify(fallas, null, 1));
for (const f of fallas.slice(0, +(process.argv.includes('--ver') ? 60 : 25))) {
  console.log(`\n· ${f.tema}\n  IN : ${f.texto.slice(0, 220)}\n  OUT: ${f.salida.slice(0, 220)}\n  escapa: ${JSON.stringify(f.se_escapa)}  pierde: ${JSON.stringify(f.se_pierde)}`);
}
