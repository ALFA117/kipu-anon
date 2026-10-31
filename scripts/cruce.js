// Cruce entre dos versiones: para cada registro, qué palabras ORIGINALES (nombres propios, números,
// correos, usuarios) siguen en la salida A pero la versión B sí cambió, y al revés.
// uso: node scripts/cruce.js <fuentes/> <salidaA/> <salidaB/> [nombreA] [nombreB]
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from '../src/parse.js';
import { KEEP } from '../src/catalog.js';
import { norm } from '../src/text.js';

const [src = 'raw/full', A = 'output', B = 'evals/out_eli', nA = 'nuestra', nB = 'Elizabeth'] = process.argv.slice(2);
const flat = v => v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? Object.values(v).flatMap(flat) : [String(v)];
const textOf = r => flat(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && !k.startsWith('_') && k !== 'thread_id' && k !== 'ts'))).join(' \n ');
const load = dir => new Map(['chats.jsonl', 'docs.jsonl', 'tables.jsonl'].flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))).map(r => [r.id, textOf(r)]));
const all = loadAll(src);
const inMap = new Map([...all.chats.records, ...all.docs, ...all.tables.records].map(r => [r.id, textOf(r)]));
const a = load(A), b = load(B);
const keep = new Set(KEEP.flatMap(k => k.split(/\s+/)).map(norm));
const STOP = new Set(['hola', 'buenos', 'buenas', 'gracias', 'listo', 'claro', 'perfecto', 'cliente', 'clienta', 'señor', 'señora', 'cedula', 'correo', 'el', 'la', 'los', 'las']);

// candidatos: nombres propios (Mayúscula), MAYÚSCULAS, números de 4+ dígitos, correos y usuarios
const tokens = t => new Set([
  ...[...t.matchAll(/\b\p{Lu}\p{Ll}{2,}(?:\s+\p{Lu}\p{Ll}{2,})*\b/gu)].map(m => m[0]),
  ...[...t.matchAll(/\b\p{Lu}{3,}(?:\s+\p{Lu}{3,})+\b/gu)].map(m => m[0]),
  ...[...t.matchAll(/\d[\d.\- ]{5,}\d/g)].map(m => m[0].replace(/\D/g, '')).filter(d => d.length >= 6),
  ...[...t.matchAll(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map(m => m[0].toLowerCase()),
]);
const present = (t, tok) => /^\d+$/.test(tok) ? t.replace(/(?<=\d)[ .\-](?=\d)/g, '').includes(tok) : norm(t).includes(norm(tok));

const onlyA = new Map(), onlyB = new Map(); // A deja el dato y B lo cambia → posible fuga de A
for (const [id, tin] of inMap) {
  const ta = a.get(id) || '', tb = b.get(id) || '';
  for (const tok of tokens(tin)) {
    const n = norm(tok);
    if (n.split(/\s+/).every(w => keep.has(w) || STOP.has(w))) continue;
    const inA = present(ta, tok), inB = present(tb, tok);
    if (inA && !inB) { if (!onlyA.has(tok)) onlyA.set(tok, []); onlyA.get(tok).push(id); }
    if (inB && !inA) { if (!onlyB.has(tok)) onlyB.set(tok, []); onlyB.get(tok).push(id); }
  }
}
const show = (m, title) => {
  const rows = [...m].sort((x, y) => y[1].length - x[1].length);
  console.log(`\n## ${title}: ${rows.length} datos distintos`);
  for (const [tok, ids] of rows.slice(0, 40)) console.log(`  ${ids.length}×  ${tok.length > 60 ? tok.slice(0, 60) + '…' : tok}   (${ids[0]})`);
};
show(onlyA, `${nA} lo deja igual y ${nB} lo cambia (¿fuga de ${nA} o sobre-anonimización de ${nB}?)`);
show(onlyB, `${nB} lo deja igual y ${nA} lo cambia (¿fuga de ${nB} o sobre-anonimización de ${nA}?)`);
