// Consistencia por persona, parecida a lo que mide el jurado: para cada persona real del maestro se buscan
// en la ENTRADA todos los registros donde aparece (nombre completo, nombre + primer apellido, cédula,
// correo, celular). En la SALIDA, esa persona debe ser UNA entidad que liste esos registros y cuyo
// seudónimo aparezca en cada uno.
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from '../src/parse.js';
import { norm } from '../src/text.js';

const flat = v => v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...flat(x)]) : [String(v)];
const textOf = r => flat(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && !k.startsWith('_')))).join(' | ');
const compact = s => s.replace(/(?<=\d)[ .\-](?=\d)/g, '');

function hasWord(hay, needle) {
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const a = hay[i - 1], b = hay[i + needle.length];
    if (!(a && /[a-z0-9]/.test(a)) && !(b && /[a-z0-9]/.test(b))) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

export function consistency(srcDir, outDir) {
  const all = loadAll(srcDir);
  const inRecs = [...all.chats.records, ...all.docs, ...all.tables.records].map(r => ({ id: r.id, n: norm(textOf(r)), d: compact(textOf(r)) }));
  const readJl = f => fs.readFileSync(path.join(outDir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const outById = new Map([...readJl('chats.jsonl'), ...readJl('docs.jsonl'), ...readJl('tables.jsonl')].map(r => [r.id, norm(textOf(r))]));
  const outDigits = new Map([...outById].map(([k, v]) => [k, compact(v)]));
  const ents = JSON.parse(fs.readFileSync(path.join(outDir, 'entities.json'), 'utf8')).entities.filter(e => !e.kept);

  const people = [
    ...(all.tables.raw.clientes || []).map(c => ({ id: c.cliente_id, name: c.nombre_completo, ced: c.num_doc, mail: c.correo, tel: c.celular })),
    ...(all.tables.raw.empleados || []).map(e => ({ id: e.id, name: e.nombre, ced: e.documento, mail: e.correo, tel: e.celular })),
  ];
  // nombres repetidos entre personas (homónimos) no sirven para encontrar registros de una sola persona
  const nameCount = new Map();
  const nameForms = p => { const t = p.name.split(/\s+/); return [p.name, t.length >= 3 ? `${t[0]} ${t[t.length - 2]}` : null].filter(Boolean).map(norm); };
  for (const p of people) for (const f of nameForms(p)) nameCount.set(f, (nameCount.get(f) || 0) + 1);

  const res = [];
  for (const p of people) {
    const strong = [p.ced, p.tel].filter(Boolean).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 7);
    const mail = (p.mail || '').toLowerCase();
    const names = nameForms(p).filter(f => nameCount.get(f) === 1);
    const truth = inRecs.filter(r => strong.some(d => r.d.includes(d)) || (mail && r.n.includes(norm(mail))) || names.some(f => hasWord(r.n, f))).map(r => r.id);
    if (!truth.length) continue;
    const ent = ents.filter(e => e.originals.some(o => strong.includes(o.replace(/\D/g, '')) || o.toLowerCase() === mail || norm(o) === norm(p.name)));
    const e = ent[0];
    const pseudo = norm(e?.pseudonyms?.name || '~').split(' ')[0];
    const missingInEntity = e ? truth.filter(id => !e.records.includes(id)) : truth;
    const missingPseudo = e ? truth.filter(id => { const t = outById.get(id) || ''; const td = outDigits.get(id) || ''; return !hasWord(t, pseudo) && !Object.values(e.pseudonyms).some(v => t.includes(norm(String(v))) || (/^[\d.\s-]+$/.test(String(v)) && td.includes(String(v).replace(/\D/g, '')))); }) : truth;
    const ok = ent.length === 1 && !missingInEntity.length && !missingPseudo.length;
    res.push({ id: p.id, name: p.name, ok, entidades: ent.length, registros: truth.length, faltan_en_entidad: missingInEntity, sin_seudonimo: missingPseudo });
  }
  return { ok: res.filter(r => r.ok).length, total: res.length, fallas: res.filter(r => !r.ok) };
}

if (process.argv[1] && process.argv[1].endsWith('consistency.js')) {
  const [src = 'raw/full', out = 'output'] = process.argv.slice(2);
  const r = consistency(src, out);
  console.log(`consistencia por persona: ${r.ok}/${r.total}`);
  for (const f of r.fallas.slice(0, 25)) console.log(`  ${f.id} ${f.name} · entidades=${f.entidades} · registros=${f.registros} · faltan en entidad=${f.faltan_en_entidad.length} ${f.faltan_en_entidad.slice(0, 2).join(',')} · sin seudónimo=${f.sin_seudonimo.length} ${f.sin_seudonimo.slice(0, 2).join(',')}`);
}
