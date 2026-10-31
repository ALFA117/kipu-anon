// Gate antes de gastar una corrida: barrido global de fuga (con la normalización del juez)
// y tests públicos/muestra.  uso: node scripts/check.js <fuentes/> <output/> [tests.json ...]
import fs from 'node:fs';
import path from 'node:path';
import { contiene, norm } from './judge-text.js';
import { loadAll } from '../src/parse.js';

const [src = 'raw/full', out = 'output', ...testFiles] = process.argv.slice(2);
const all = loadAll(src);
const readJl = f => fs.readFileSync(path.join(out, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const recs = { chats: readJl('chats.jsonl'), docs: readJl('docs.jsonl'), tables: readJl('tables.jsonl') };
const ents = JSON.parse(fs.readFileSync(path.join(out, 'entities.json'), 'utf8')).entities;
const byId = new Map(Object.values(recs).flat().map(r => [r.id, r]));
const flat = v => v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...flat(x)]) : [String(v)];
const textOf = (r, field) => {
  if (!field || field === '*') return flat(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id'))).join(' | ');
  if (field.startsWith('columns.')) return flat(r.columns?.[field.slice(8)]).join(' | ');
  return flat(r[field]).join(' | ');
};
const texts = [...byId.values()].map(r => [r.id, textOf(r)]);

// ---------- barrido global ----------
const truth = new Set();
const twoNames = n => { const t = n.split(/\s+/); return t.length >= 3 ? [t.slice(0, t.length - 1).join(' '), `${t[0]} ${t[t.length - 2]}`] : []; };
for (const c of all.tables.raw.clientes || []) [c.nombre_completo, ...twoNames(c.nombre_completo), c.num_doc, c.correo, c.celular, c.direccion, c.fecha_nacimiento].forEach(x => x && truth.add(x));
for (const e of all.tables.raw.empleados || []) [e.nombre, ...twoNames(e.nombre), e.correo, e.celular, e.documento, e.fecha_nacimiento].forEach(x => x && truth.add(x));
for (const u of all.chats.users || []) if (!u.is_bot) [u.real_name, u.profile?.email, u.profile?.phone].forEach(x => x && x.length >= 3 && truth.add(x));
const leaks = [];
for (const f of truth) {
  if (!f.includes(' ') && !/\d|@/.test(f)) continue;
  const hit = texts.filter(([, t]) => contiene(t, f)).map(([id]) => id);
  if (hit.length) leaks.push({ form: f, n: hit.length, ej: hit.slice(0, 3) });
}
console.log(`barrido: ${truth.size} formas reales revisadas · ${leaks.length} con fuga`);
for (const l of leaks.slice(0, 40)) console.log('  FUGA', JSON.stringify(l));

// ---------- tests ----------
let ok = 0, tot = 0;
for (const tf of testFiles) {
  const tests = JSON.parse(fs.readFileSync(tf, 'utf8'));
  for (const t of Array.isArray(tests) ? tests : tests.tests) {
    tot++;
    let pass = false, why = '';
    const r = t.locator?.record ? byId.get(t.locator.record) : null;
    const field = t.locator?.field;
    if (t.family === 'falso_positivo') pass = r && t.payload.every(p => textOf(r, field).includes(p));
    else if (['directa', 'oculta'].includes(t.family)) {
      pass = r && t.payload.every(p => !contiene(textOf(r, field), p));
      if (pass && t.family === 'directa') { const other = texts.filter(([, x]) => t.payload.some(p => contiene(x, p))); pass = !other.length; why = other.map(o => o[0]).slice(0, 2).join(','); }
    } else if (t.family === 'indirecta') pass = r && !t.payload.every(p => textOf(r, field).includes(p));
    else if (t.family === 'homonimos') {
      const v = r && textOf(r, field);
      const same = Object.values(all.tables.raw).flat().filter(x => x && x.nombre_completo && norm(x.nombre_completo) === norm(t.payload[0]));
      const outs = same.map(x => recs.tables.find(y => y.id === `clientes:${x.cliente_id}`)?.columns.nombre_completo);
      pass = !!v && new Set(outs).size === outs.length && !outs.some(o => contiene(o, t.payload[0]));
      why = outs.join(' / ');
    } else if (t.family === 'consistencia') {
      const forms = new Set((t.lookup_forms || []).map(norm));
      const e = ents.find(x => x.originals.some(o => forms.has(norm(o))));
      const nameToks = (e?.pseudonyms.name || '').split(' ');
      const first = nameToks[0], last = nameToks[nameToks.length - 1];
      // vale el nombre de pila, el apellido ("V. Duque") o cualquier otro seudónimo de la persona
      const bad = e ? e.records.filter(id => { const rr = byId.get(id); return !(rr && (contiene(textOf(rr), first) || contiene(textOf(rr), last) || Object.values(e.pseudonyms).some(v => contiene(textOf(rr), v)))); }) : [];
      pass = !!e && !bad.length && (t.records ? t.records.every(id => e.records.includes(id)) : true);
      if (bad.length) why += ' sin seudónimo en ' + bad.slice(0, 2).join(',');
      why = e ? `${e.entity_id} ${e.pseudonyms.name} (${e.records.length} registros)` : 'sin entidad';
    }
    if (pass) ok++;
    console.log(`${pass ? 'PASA ' : 'FALLA'} ${t.id} ${t.family}/${t.mechanism} ${why}`);
  }
}
if (tot) console.log(`tests: ${ok}/${tot}`);
