// Métricas estrictas, organizadas como la rúbrica del jurado (fuga 45 · utilidad 35 · consistencia 20).
// Más duras que los tests públicos: buscan más formas reales, exigen que cada mensaje escrito por una
// persona lleve su seudónimo, que los homónimos no se crucen y que el texto no personal quede igual.
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from '../src/parse.js';
import { norm, stripAccents } from '../src/text.js';
import { contiene } from './judge-text.js';
import { KEEP, FEMALE, MALE, FEMALE_EXTRA } from '../src/catalog.js';

const flat = v => v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...flat(x)]) : [String(v)];
const textOf = r => flat(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && !k.startsWith('_')))).join(' | ');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hasWord = (hay, needle) => {
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const a = hay[i - 1], b = hay[i + needle.length];
    if (!(a && /[a-z0-9]/.test(a)) && !(b && /[a-z0-9]/.test(b))) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
};
const genderOf = first => {
  const n = norm(first);
  if (FEMALE.some(f => norm(f) === n) || FEMALE_EXTRA.has(n)) return 'F';
  if (MALE.some(f => norm(f) === n)) return 'M';
  return n.endsWith('a') ? 'F' : 'M';
};

export function hardChecks(srcDir, outDir) {
  const all = loadAll(srcDir);
  const readJl = f => fs.readFileSync(path.join(outDir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const outRecs = [...readJl('chats.jsonl'), ...readJl('docs.jsonl'), ...readJl('tables.jsonl')];
  const outById = new Map(outRecs.map(r => [r.id, r]));
  const outText = new Map(outRecs.map(r => [r.id, textOf(r)]));
  const outNorm = new Map([...outText].map(([k, v]) => [k, norm(v)]));
  const inRecs = [...all.chats.records, ...all.docs, ...all.tables.records];
  const inText = new Map(inRecs.map(r => [r.id, textOf(r)]));
  const ents = JSON.parse(fs.readFileSync(path.join(outDir, 'entities.json'), 'utf8')).entities.filter(e => !e.kept);
  const users = all.chats.users || [];
  const clientes = all.tables.raw.clientes || [];
  const empleados = all.tables.raw.empleados || [];

  // ---------------- FUGA (45) ----------------
  const forms = new Map(); // forma -> tipo
  const addF = (f, t) => { if (f && String(f).trim().length >= 4) forms.set(String(f).trim(), t); };
  const people = [
    ...clientes.map(c => ({ id: c.cliente_id, name: c.nombre_completo, ced: c.num_doc, mail: c.correo, tel: c.celular, dir: c.direccion, birth: c.fecha_nacimiento })),
    ...empleados.map(e => ({ id: e.id, name: e.nombre, ced: e.documento, mail: e.correo, tel: e.celular, birth: e.fecha_nacimiento })),
  ];
  for (const p of people) {
    const t = p.name.split(/\s+/);
    addF(p.name, 'nombre');
    if (t.length >= 3) { addF(`${t[0]} ${t[t.length - 2]}`, 'nombre'); addF(`${t[0]} ${t[t.length - 1]}`, 'nombre'); }
    if (t.length >= 4) { addF(`${t[1]} ${t[2]}`, 'nombre'); addF(`${t[0]} ${t[1]} ${t[2]}`, 'nombre'); }
    addF(stripAccents(p.name).toUpperCase(), 'nombre');
    addF(`${norm(t[0])}_${norm(t[t.length >= 3 ? t.length - 2 : 1] || '')}`, 'archivo');
    addF(p.ced, 'cedula');
    if (p.ced && p.ced.length >= 7) addF(p.ced.replace(/\B(?=(\d{3})+(?!\d))/g, '.'), 'cedula');
    addF(p.mail, 'correo');
    if (p.mail) { const [l, d] = p.mail.split('@'); addF(`${l} arroba ${d.replace(/\./g, ' punto ')}`, 'correo'); if (l.length >= 5) addF(l, 'usuario'); }
    addF(p.tel, 'celular');
    if (p.tel) addF(`${p.tel.slice(0, 3)} ${p.tel.slice(3, 6)} ${p.tel.slice(6)}`, 'celular');
    addF(p.dir, 'direccion');
    if (p.birth) {
      const [y, m, d] = p.birth.split('-');
      addF(p.birth, 'nacimiento'); addF(`${+d} de ${MESES[+m - 1]} de ${y}`, 'nacimiento'); addF(`${d}/${m}/${y}`, 'nacimiento');
    }
  }
  for (const u of users) if (!u.is_bot && u.name && u.name.length >= 5 && /[._]/.test(u.name)) addF(u.name, 'usuario');
  // placas, pasaportes y cuentas que aparecen en la entrada con su contexto
  for (const [, t] of inText) {
    for (const m of t.matchAll(/(?:placa|car is|soat)[^\n]{0,20}?\b([A-Z]{3}-?\d{3})\b/gi)) addF(m[1], 'placa');
    for (const m of t.matchAll(/pasaporte[^\n]{0,15}?\b([A-Z]{1,2}\d{6,8})\b/gi)) addF(m[1], 'pasaporte');
    for (const m of t.matchAll(/cuenta[^\n]{0,25}?(\d{3,6}(?:[ -]\d{3,6}){1,4})/gi)) addF(m[1], 'cuenta');
  }
  const outAll = [...outText.values()];
  const outBig = outAll.join('\n');
  const leaks = [];
  for (const [f, t] of forms) {
    if (KEEP.some(k => norm(k) === norm(f))) continue;
    if (contiene(outBig, f)) leaks.push({ forma: f, tipo: t, en: outRecs.filter(r => contiene(outText.get(r.id), f)).slice(0, 2).map(r => r.id) });
  }
  const fugaPts = Math.max(0, 45 - leaks.length * 1.5);

  // ---------------- UTILIDAD (35) ----------------
  // 9: conservados intactos (cuántas veces aparece cada marca/lugar en la entrada vs. la salida)
  let keepIn = 0, keepOut = 0;
  const inAll = [...inText.values()].join('\n'), outJoined = outBig;
  for (const k of KEEP) {
    if (k.length < 4) continue;
    const rx = new RegExp(`(?<![\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu');
    const a = (inAll.match(rx) || []).length, b = (outJoined.match(rx) || []).length;
    keepIn += a; keepOut += Math.min(a, b);
  }
  const keepRatio = keepIn ? keepOut / keepIn : 1;
  // 8: categoría del seudónimo (género, largo de cédula, correo válido, celular 3XX, lejos del original)
  let catOk = 0, catTot = 0;
  for (const c of clientes) {
    const r = outById.get(`clientes:${c.cliente_id}`);
    if (!r) continue;
    const o = r.columns;
    catTot++;
    const sameGender = genderOf(c.nombre_completo.split(' ')[0]) === genderOf(o.nombre_completo.split(' ')[0]);
    const cedOk = /^\d+$/.test(o.num_doc) && o.num_doc.length === c.num_doc.length && o.num_doc !== c.num_doc;
    const mailOk = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(o.correo) && o.correo !== c.correo;
    const telOk = /^3\d{9}$/.test(o.celular) && o.celular !== c.celular;
    const far = !c.nombre_completo.split(' ').slice(1).some(s => o.nombre_completo.includes(s));
    if (sameGender && cedOk && mailOk && telOk && far) catOk++;
  }
  const catRatio = catTot ? catOk / catTot : 1;
  // 8: estructura (ids de negocio, montos y fechas de transacción intactos; uniones entre tablas)
  let structOk = 0, structTot = 0;
  for (const rec of all.tables.records) {
    const o = outById.get(rec.id);
    structTot++;
    if (!o) continue;
    const keys = { clientes: ['cliente_id', 'ciudad', 'fecha_vinculacion'], transacciones: ['tx_id', 'fecha', 'cliente_id', 'tipo', 'monto', 'canal', 'estado'], pqrs: ['radicado', 'cliente_id', 'fecha', 'tipo', 'estado', 'ciudad'], empleados: ['id', 'cargo', 'ciudad', 'ingreso'] }[rec.table] || [];
    if (keys.every(k => o.columns[k] === rec.columns[k])) structOk++;
  }
  const structRatio = structTot ? structOk / structTot : 1;
  // 10: parecido del texto no personal (tokens iguales en el mismo orden)
  let simSum = 0, simN = 0;
  for (const r of all.chats.records) {
    const a = r.text.split(/\s+/), b = (outById.get(r.id)?.text || '').split(/\s+/);
    if (!a.length) continue;
    let same = 0;
    for (let i = 0, j = 0; i < a.length && j < b.length; i++, j++) if (a[i] === b[j]) same++;
    simSum += same / Math.max(a.length, b.length); simN++;
  }
  const simRatio = simN ? simSum / simN : 1;
  const utilPts = 9 * keepRatio + 8 * catRatio + 8 * structRatio + 10 * Math.min(1, simRatio / 0.9);

  // ---------------- CONSISTENCIA (20) ----------------
  // 8: misma persona, mismo seudónimo: mensajes que ESCRIBIÓ (uid ligado por correo) + menciones por nombre completo único
  const nameCount = new Map();
  for (const p of people) { const k = norm(p.name); nameCount.set(k, (nameCount.get(k) || 0) + 1); }
  const uidsByMail = new Map(users.filter(u => u.profile?.email).map(u => [u.profile.email.toLowerCase(), u.id]));
  const byAuthor = new Map();
  for (const r of all.chats.records) { if (!byAuthor.has(r._user)) byAuthor.set(r._user, []); byAuthor.get(r._user).push(r.id); }
  let pOk = 0, pTot = 0;
  const pFails = [];
  for (const p of people) {
    const uid = p.mail && uidsByMail.get(p.mail.toLowerCase());
    const authored = uid ? (byAuthor.get(uid) || []) : [];
    const mentioned = nameCount.get(norm(p.name)) === 1 ? [...inText].filter(([, t]) => hasWord(norm(t), norm(p.name))).map(([id]) => id) : [];
    const truth = [...new Set([...authored, ...mentioned])];
    if (!truth.length) continue;
    pTot++;
    const cand = ents.filter(e => e.originals.some(o => o === p.ced || o === p.mail || norm(o) === norm(p.name)));
    const e = cand.length === 1 ? cand[0] : null;
    const first = norm(e?.pseudonyms?.name || '~').split(' ')[0];
    const bad = e ? truth.filter(id => !e.records.includes(id) || !hasWord(outNorm.get(id) || '', first)) : truth;
    if (e && !bad.length) pOk++; else pFails.push(`${p.id}${e ? '' : ` (${cand.length} entidades)`} ${bad.slice(0, 2).join(',')}`);
  }
  const names = ents.map(e => e.pseudonyms?.name).filter(Boolean);
  const unicidad = names.length ? new Set(names.map(norm)).size / names.length : 1;
  const sameRatio = (pTot ? pOk / pTot : 1) * unicidad;
  // 5: homónimos: mismo nombre completo o nombre+apellido en el maestro → seudónimos distintos y sin cruzarse
  const groups = new Map();
  for (const p of people) { const t = p.name.split(/\s+/); const k = norm(`${t[0]} ${t[t.length >= 3 ? t.length - 2 : 1]}`); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  let hOk = 0, hTot = 0;
  const hFails = [];
  for (const [k, ps0] of groups) {
    // la misma cédula es la misma persona (cliente migrado con id nuevo): no son homónimos
    const ps = [...new Map(ps0.map(p => [String(p.ced || p.id).replace(/\D/g, '') || p.id, p])).values()];
    if (ps.length < 2) continue;
    hTot++;
    const pe = ps.map(p => ents.find(e => e.originals.includes(p.ced) || e.originals.includes(p.mail)));
    const pn = pe.map(e => e?.pseudonyms?.name);
    const distinct = pn.every(Boolean) && new Set(pn.map(norm)).size === pn.length;
    // los mensajes escritos por cada homónimo deben llevar SU seudónimo
    const crossed = ps.some((p, i) => {
      const uid = p.mail && uidsByMail.get(p.mail.toLowerCase());
      return (uid ? byAuthor.get(uid) || [] : []).some(id => !hasWord(norm(outById.get(id)?.author || ''), norm(pn[i] || '~').split(' ')[0]));
    });
    if (distinct && !crossed) hOk++; else hFails.push(`${k}: ${pn.join(' / ')}${crossed ? ' (cruzados)' : ''}`);
  }
  const homRatio = hTot ? hOk / hTot : 1;
  // 4: "reporta a" entre empleados
  const empOut = new Map(empleados.map(e => [e.id, outById.get(`empleados:${e.id}`)?.columns]));
  let rOk = 0, rTot = 0;
  for (const e of empleados) {
    if (!e.reporta_a) continue;
    rTot++;
    const boss = empleados.find(b => norm(b.nombre).startsWith(norm(e.reporta_a)));
    const outBoss = boss && empOut.get(boss.id)?.nombre;
    const outRep = empOut.get(e.id)?.reporta_a;
    if (outBoss && outRep && norm(outBoss).startsWith(norm(outRep))) rOk++;
  }
  const repRatio = rTot ? rOk / rTot : 1;
  // 3: honestidad del diccionario: formas reales de cada persona que aparecían en la entrada y quedaron declaradas
  let honOk = 0, honTot = 0;
  for (const p of people) {
    const e = ents.find(x => x.originals.includes(p.ced) || x.originals.includes(p.mail));
    for (const f of [p.name, p.ced, p.mail, p.tel].filter(Boolean)) {
      if (!inAll.includes(f)) continue;
      honTot++;
      if (e && e.originals.some(o => norm(o) === norm(f) || o.replace(/\D/g, '') === f.replace(/\D/g, '') && /\d/.test(f))) honOk++;
    }
  }
  const honRatio = honTot ? honOk / honTot : 1;
  const consPts = 8 * sameRatio + 5 * homRatio + 4 * repRatio + 3 * honRatio;

  const nota = Math.round((fugaPts + utilPts + consPts) * 10) / 10;
  return {
    nota,
    fuga: { pts: +fugaPts.toFixed(1), formas: forms.size, fugadas: leaks.length, ejemplos: leaks.slice(0, 12) },
    utilidad: { pts: +utilPts.toFixed(1), conservados: +keepRatio.toFixed(3), categoria: +catRatio.toFixed(3), estructura: +structRatio.toFixed(3), parecido: +simRatio.toFixed(3) },
    consistencia: { pts: +consPts.toFixed(1), misma_persona: `${pOk}/${pTot}`, unicidad: +unicidad.toFixed(3), homonimos: `${hOk}/${hTot}`, reporta_a: `${rOk}/${rTot}`, honestidad: `${honOk}/${honTot}`, fallas_persona: pFails.slice(0, 10), fallas_homonimos: hFails },
  };
}

if (process.argv[1] && process.argv[1].endsWith('hard-checks.js')) {
  const [src = 'raw/full', out = 'output'] = process.argv.slice(2);
  console.log(JSON.stringify(hardChecks(src, out), null, 1));
}
