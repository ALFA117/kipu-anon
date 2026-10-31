// JUEZ LOCAL: genera cientos de casos a partir de los datos reales, con las mismas familias que el set
// oculto de Frontier (directa, oculta, indirecta, falso positivo, homónimos, consistencia, en vivo),
// y los califica como el jurado. No gasta corridas oficiales.
//
// uso: node scripts/juez.js [--src raw/full] [--out output] [--nota "qué cambié"] [--fallas 20]
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from '../src/parse.js';
import { runPipeline } from '../src/pipeline.js';
import { anonymizeBatch } from '../src/live.js';
import { norm, stripAccents } from '../src/text.js';
import { KEEP, SECTOR } from '../src/catalog.js';
import { contiene } from './judge-text.js';
import { runLiveCases, httpCaller } from './live-test.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const src = arg('--src', 'raw/full');
const out = arg('--out', 'evals/out_juez');
const showFails = +arg('--fallas', 15);

// ---------- correr el sistema (o solo calificar una salida ya hecha, p. ej. la de otra versión) ----------
// --solo-calificar: usa la salida que ya está en --out; --live-url: pruebas en vivo contra ese servicio
const gradeOnly = process.argv.includes('--solo-calificar');
const liveUrl = arg('--live-url', null);
let run = null;
if (!gradeOnly) {
  fs.rmSync(out, { recursive: true, force: true });
  const storedCopy = 'evals/pseudonyms.juez.tmp.json';
  if (fs.existsSync('data/pseudonyms.json')) fs.copyFileSync('data/pseudonyms.json', storedCopy);
  run = runPipeline({ srcDir: src, outDir: out, storedFile: fs.existsSync(storedCopy) ? storedCopy : null });
  fs.rmSync(storedCopy, { force: true });
}

const all = loadAll(src);
const flat = v => v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...flat(x)]) : [String(v)];
const textOf = (r, field) => {
  if (!field) return flat(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && !k.startsWith('_')))).join(' | ');
  if (field.startsWith('columns.')) return flat(r.columns?.[field.slice(8)]).join(' | ');
  return flat(r[field]).join(' | ');
};
const readJl = f => fs.readFileSync(path.join(out, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const outRecs = [...readJl('chats.jsonl'), ...readJl('docs.jsonl'), ...readJl('tables.jsonl')];
const O = new Map(outRecs.map(r => [r.id, r]));
const outBig = outRecs.map(r => textOf(r)).join('\n');
const inRecs = [...all.chats.records, ...all.docs, ...all.tables.records];
const I = new Map(inRecs.map(r => [r.id, r]));
const ents = JSON.parse(fs.readFileSync(path.join(out, 'entities.json'), 'utf8')).entities.filter(e => !e.kept);
const clientes = all.tables.raw.clientes || [];
const empleados = all.tables.raw.empleados || [];
const users = all.chats.users || [];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const tests = [];
const T = (family, mechanism, difficulty, record, field, payload, check) => tests.push({ family, mechanism, difficulty, record, field, payload, check });
const absentIn = (rid, field, p) => () => { const r = O.get(rid); return !!r && !contiene(textOf(r, field), p); };
const absentEverywhere = (rid, field, p) => () => absentIn(rid, field, p)() && !contiene(outBig, p);
const firstRec = pred => inRecs.find(pred);

// ---------- DIRECTA: datos explícitos de cada persona ----------
const people = [
  ...clientes.map(c => ({ kind: 'cliente', id: c.cliente_id, name: c.nombre_completo, ced: c.num_doc, mail: c.correo, tel: c.celular, dir: c.direccion, birth: c.fecha_nacimiento })),
  ...empleados.map(e => ({ kind: 'empleado', id: e.id, name: e.nombre, ced: e.documento, mail: e.correo, tel: e.celular, birth: e.fecha_nacimiento })),
];
const inTxt = new Map(inRecs.map(r => [r.id, textOf(r)]));
const findIn = (p, skipTables = true) => [...inTxt].find(([id, t]) => (!skipTables || !id.includes(':')) && contiene(t, p))?.[0];
for (const p of people) {
  const t = p.name.split(/\s+/);
  const short = t.length >= 3 ? `${t[0]} ${t[t.length - 2]}` : p.name;
  const forms = [['nombre_completo', p.name], ['nombre_corto', short], ['cedula', p.ced], ['correo', p.mail], ['celular', p.tel]];
  for (const [mech, val] of forms) {
    if (!val) continue;
    const rid = findIn(val) || (p.kind === 'cliente' ? `clientes:${p.id}` : `empleados:${p.id}`);
    if (!I.has(rid)) continue;
    T('directa', `${mech}_${rid.includes(':') ? 'tabla' : 'texto'}`, rid.includes(':') ? 'fácil' : 'regular', rid, null, val, absentEverywhere(rid, null, val));
  }
  if (p.dir) T('directa', 'direccion', 'fácil', `clientes:${p.id}`, 'columns.direccion', p.dir, absentEverywhere(`clientes:${p.id}`, null, p.dir));
  if (p.birth) {
    const [y, m, d] = p.birth.split('-');
    const long = `${+d} de ${MESES[+m - 1]} de ${y}`;
    const rid = findIn(long);
    if (rid) T('directa', 'nacimiento_en_palabras', 'difícil', rid, null, long, absentIn(rid, null, long));
  }
}

// ---------- OCULTA: lugares escondidos ----------
for (const r of all.chats.records) for (const a of r.attachments) {
  for (const p of people) {
    const t = p.name.split(/\s+/);
    const tok = norm(`${t[0]}_${t[t.length >= 3 ? t.length - 2 : 1]}`);
    if (norm(a.filename).includes(tok)) T('oculta', 'nombre_en_adjunto', 'regular', r.id, 'attachments', tok, absentIn(r.id, 'attachments', tok));
  }
  for (const m of a.filename.matchAll(/\d{7,10}/g)) T('oculta', 'cedula_en_adjunto', 'difícil', r.id, 'attachments', m[0], absentIn(r.id, 'attachments', m[0]));
}
for (const d of all.docs) {
  for (const [k, v] of Object.entries(d.metadata || {})) {
    if (!/author|autor|revisado|owner|preparado/i.test(k)) continue;
    if (/@|^\p{Lu}\p{L}+\s+\p{Lu}/u.test(v) && !/gerencia|equipo|soporte|team|legal|área|area|marketing|security|seguridad|kipu/i.test(v)) T('oculta', `metadata_${k}`, 'regular', d.id, 'metadata', v.replace(/^@/, ''), absentIn(d.id, null, v.replace(/^@/, '')));
  }
  for (const m of (d.body || '').matchAll(/<!--([\s\S]*?)-->/g)) for (const p of people) if (contiene(m[1], p.name.split(' ').slice(0, 2).join(' '))) T('oculta', 'comentario_html', 'difícil', d.id, 'body', p.name.split(' ').slice(0, 2).join(' '), absentIn(d.id, 'body', p.name.split(' ').slice(0, 2).join(' ')));
  for (const p of people) {
    const tok = norm(p.name.split(' ')[0] + '_' + p.name.split(' ').slice(-2)[0]);
    if (norm(d.filename).includes(tok)) T('oculta', 'nombre_en_nombre_de_archivo', 'regular', d.id, 'filename', tok, absentIn(d.id, 'filename', tok));
  }
}
for (const r of inRecs) {
  const t = inTxt.get(r.id);
  for (const m of t.matchAll(/\b([a-z0-9][a-z0-9._-]*)\s+arroba\s+([a-z0-9-]+)((?:\s+punto\s+[a-z]{2,})+)/gi)) T('oculta', 'correo_deletreado', 'difícil', r.id, null, m[1], absentIn(r.id, null, `${m[1]} arroba`));
  for (const m of t.matchAll(/[?&](?:u|ref|user|usuario)=([a-z][a-z0-9._]{3,})/gi)) T('oculta', 'usuario_en_link', 'difícil', r.id, null, m[1], absentIn(r.id, null, m[1]));
  for (const m of t.matchAll(/(?<![\w.])@([a-z][a-z0-9._]{3,})(?![\w@])/g)) T('oculta', 'arroba_handle', 'difícil', r.id, null, m[1], absentIn(r.id, null, m[1]));
  for (const m of t.matchAll(/\b([A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]{3,}){1,3})\b/g)) {
    const hit = people.find(p => norm(m[1]).includes(norm(p.name.split(' ').slice(0, 2).join(' '))));
    if (hit) T('oculta', 'nombre_en_mayusculas', 'regular', r.id, null, m[1], absentIn(r.id, null, m[1]));
  }
  for (const m of t.matchAll(/(?<![\p{L}])(\p{Lu})\.\s?(\p{Lu}\p{Ll}{3,})(?![\p{L}])/gu)) {
    if (people.some(p => norm(p.name[0]) === norm(m[1]) && p.name.split(/\s+/).slice(1).some(x => norm(x) === norm(m[2])))) T('oculta', 'inicial_y_apellido', 'difícil', r.id, null, m[0], absentIn(r.id, null, m[0]));
  }
  for (const m of t.matchAll(/(?:placa|car is|soat)[^\n]{0,20}?\b([A-Z]{3}-?\d{3})\b/gi)) T('oculta', 'placa', 'regular', r.id, null, m[1], absentIn(r.id, null, m[1]));
  for (const m of t.matchAll(/pasaporte[^\n]{0,15}?\b([A-Z]{1,2}\d{6,8})\b/gi)) T('oculta', 'pasaporte', 'regular', r.id, null, m[1], absentIn(r.id, null, m[1]));
  for (const m of t.matchAll(/[ú|u]ltimos (?:cuatro|4)[^\n]{0,60}/gi)) void m;
}
// últimos 4 dígitos: respuesta del cliente en verificación
for (const r of all.chats.records) {
  const m = r.text.match(/^\s*(?:.*\b)?(\d{4})\s*(?:y|,|$)/);
  if (!m) continue;
  const p = clientes.find(c => (c.num_doc || '').endsWith(m[1]) && users.find(u => u.id === r._user && (u.profile?.email || '').toLowerCase() === c.correo.toLowerCase()));
  if (p) T('oculta', 'ultimos_4_cedula', 'difícil', r.id, 'text', m[1], absentIn(r.id, 'text', m[1]));
}

// ---------- FALSO POSITIVO: lo que debe quedarse igual ----------
const seenKeep = new Map();
const personTokens = new Set(people.flatMap(p => p.name.split(/\s+/).slice(1).map(norm)));
for (const r of inRecs) {
  if (r.id.includes(':')) continue; // solo texto libre de chats y documentos
  const t = r.text ?? r.body ?? '';
  for (const k of KEEP) {
    if (k.length < 4 || (seenKeep.get(k) || 0) >= 3) continue;
    const kr = new RegExp(`(?<![\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u');
    if (!kr.test(t)) continue;
    // si el término también es apellido y va pegado a un nombre propio, es una persona: no es falso positivo
    if (personTokens.has(norm(k)) && new RegExp(`\\p{Lu}\\p{Ll}+\\s+${k}`, 'u').test(t)) continue;
    seenKeep.set(k, (seenKeep.get(k) || 0) + 1);
    T('falso_positivo', 'conservar_' + norm(k).replace(/\s+/g, '_'), 'fácil', r.id, null, k, () => kr.test((O.get(r.id)?.text ?? O.get(r.id)?.body) || ''));
  }
}
for (const rec of all.tables.records.filter(r => r.table === 'transacciones').slice(0, 30)) {
  T('falso_positivo', 'monto_y_fecha_intactos', 'fácil', rec.id, 'columns', `${rec.columns.monto} ${rec.columns.fecha}`, () => O.get(rec.id)?.columns.monto === rec.columns.monto && O.get(rec.id)?.columns.fecha === rec.columns.fecha);
}

// ---------- INDIRECTA: ocupación + barrio + año ----------
for (const c of clientes) {
  const occ = c.ocupacion, bar = c.barrio, year = (c.fecha_vinculacion || '').slice(0, 4);
  const rid = [...inTxt].find(([id, t]) => !id.includes(':') && t.includes(occ) && (t.includes(bar) || t.includes(year)))?.[0];
  if (rid) T('indirecta', 'ocupacion_barrio_anio_texto', 'difícil', rid, null, `${occ} + ${bar}/${year}`, () => { const t = textOf(O.get(rid)); return !(t.includes(occ) && (t.includes(bar) || t.includes(year))); });
  T('indirecta', 'ocupacion_barrio_tabla', 'regular', `clientes:${c.cliente_id}`, 'columns', `${occ} + ${bar}`, () => { const o = O.get(`clientes:${c.cliente_id}`)?.columns; return !!o && !(o.ocupacion === occ && o.barrio === bar); });
}

// ---------- HOMÓNIMOS ----------
const byShort = new Map();
for (const p of people) { const t = p.name.split(/\s+/); const k = norm(`${t[0]} ${t[t.length >= 3 ? t.length - 2 : 1]}`); if (!byShort.has(k)) byShort.set(k, []); byShort.get(k).push(p); }
const uidByMail = new Map(users.filter(u => u.profile?.email).map(u => [u.profile.email.toLowerCase(), u.id]));
for (const [k, ps] of byShort) {
  if (ps.length < 2) continue;
  const ent = p => ents.find(e => e.originals.includes(p.ced) || e.originals.includes(p.mail));
  T('homonimos', 'dos_personas_dos_seudonimos', 'regular', null, null, k, () => { const n = ps.map(p => ent(p)?.pseudonyms?.name); return n.every(Boolean) && new Set(n.map(norm)).size === n.length; });
  for (const p of ps) {
    const tableId = p.kind === 'cliente' ? `clientes:${p.id}` : `empleados:${p.id}`;
    T('homonimos', 'fila_con_su_seudonimo', 'regular', tableId, null, p.name, () => { const e = ent(p); const o = textOf(O.get(tableId) || {}); return !!e && norm(o).includes(norm(e.pseudonyms.name.split(' ')[0])); });
    const uid = p.mail && uidByMail.get(p.mail.toLowerCase());
    const authored = all.chats.records.filter(r => r._user === uid).slice(0, 3);
    for (const r of authored) T('homonimos', 'mensaje_del_homonimo', 'difícil', r.id, 'author', p.name, () => { const e = ent(p); return !!e && norm(O.get(r.id)?.author || '').startsWith(norm(e.pseudonyms.name.split(' ')[0])); });
  }
  // menciones con radicado o id en la misma línea
  for (const p of ps) for (const r of inRecs) {
    const t = inTxt.get(r.id);
    for (const line of t.split('\n')) {
      if (!norm(line).includes(k)) continue;
      const pqr = (line.match(/PQR-\d{4}-\d{3,5}/) || [])[0];
      const cl = (line.match(/CL-\d{4,6}/) || [])[0];
      const owner = cl || (pqr && (all.tables.raw.pqrs || []).find(x => x.radicado === pqr)?.cliente_id);
      if (owner !== p.id) continue;
      T('homonimos', 'mencion_con_radicado_o_id', 'difícil', r.id, null, `${k} (${pqr || cl})`, () => {
        const e = ent(p);
        const olines = textOf(O.get(r.id)).split('\n').filter(l => l.includes(pqr || cl));
        return !!e && olines.some(l => norm(l).includes(norm(e.pseudonyms.name.split(' ')[0])));
      });
    }
  }
}

// ---------- CONSISTENCIA: misma persona, mismo seudónimo ----------
for (const p of people) {
  const e = ents.filter(x => x.originals.some(o => o === p.ced || o === p.mail || norm(o) === norm(p.name)));
  const uid = p.mail && uidByMail.get(p.mail.toLowerCase());
  const truth = [...new Set([...(uid ? all.chats.records.filter(r => r._user === uid).map(r => r.id) : []), ...[...inTxt].filter(([id, t]) => !id.includes(':') && (contiene(t, p.ced || '~~') || contiene(t, p.mail || '~~'))).map(([id]) => id)])];
  if (!truth.length) continue;
  T('consistencia', 'misma_persona_mismo_token', 'difícil', null, null, p.name, () => {
    if (e.length !== 1) return false;
    const first = norm(e[0].pseudonyms?.name || '~').split(' ')[0];
    const vals = Object.values(e[0].pseudonyms || {}).map(String);
    return truth.every(id => {
      const t = textOf(O.get(id) || {});
      return e[0].records.includes(id) && (norm(t).includes(first) || vals.some(v => contiene(t, v)));
    });
  });
}
// "reporta a"
for (const x of empleados.filter(e => e.reporta_a)) {
  const boss = empleados.find(b => norm(b.nombre).startsWith(norm(x.reporta_a)));
  T('consistencia', 'reporta_a', 'regular', `empleados:${x.id}`, 'columns.reporta_a', x.reporta_a, () => {
    const o = O.get(`empleados:${x.id}`)?.columns, b = boss && O.get(`empleados:${boss.id}`)?.columns;
    return !!o && !!b && norm(b.nombre).startsWith(norm(o.reporta_a));
  });
}

// ---------- calificar ----------
for (const t of tests) { try { t.pass = !!t.check(); } catch { t.pass = false; } }
// en vivo: en proceso con nuestra versión, o por HTTP contra --live-url
let caller = null;
if (liveUrl) caller = httpCaller(liveUrl);
else if (run) {
  const state = { reg: run.reg, an: run.an, threads: run.threads };
  caller = async (source, records) => {
    if (!['chats', 'docs', 'tables'].includes(source)) return { status: 422, ms: 0, json: null };
    try { return { status: 200, ms: 0, json: anonymizeBatch(state, source, records) }; } catch (e) { return { status: 500, ms: 0, json: null, body: String(e) }; }
  };
}
if (caller) {
  const live = await runLiveCases(caller, out, path.join(src, 'tables/clientes.csv'), true);
  for (let i = 0; i < live.total; i++) tests.push({ family: 'en_vivo', mechanism: i < live.ok ? 'ok' : live.fails[i - live.ok], difficulty: 'difícil', pass: i < live.ok, payload: '' });
}

// ---------- reporte estilo Frontier ----------
const pass = tests.filter(t => t.pass).length;
const byDiff = d => `${tests.filter(t => t.difficulty === d && t.pass).length} / ${tests.filter(t => t.difficulty === d).length}`;
const fams = [...new Set(tests.map(t => t.family))];
console.log(`\nJUEZ LOCAL · ${src}\n`);
console.log(`TESTS QUE PASAN   ${pass} / ${tests.length}   (${(100 * pass / tests.length).toFixed(1)} %)`);
console.log(`FÁCILES ${byDiff('fácil')}   REGULARES ${byDiff('regular')}   DIFÍCILES ${byDiff('difícil')}\n`);
console.log('| familia | pasan | total | % |');
console.log('|---|---|---|---|');
for (const f of fams) { const a = tests.filter(t => t.family === f); const ok = a.filter(t => t.pass).length; console.log(`| ${f} | ${ok} | ${a.length} | ${(100 * ok / a.length).toFixed(0)} % |`); }
const fails = tests.filter(t => !t.pass);
const why = {};
for (const t of fails) why[t.family] = (why[t.family] || 0) + 1;
console.log('\nPOR QUÉ FALLAN', Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nada');
const mechFails = {};
for (const t of fails) mechFails[`${t.family}/${t.mechanism}`] = (mechFails[`${t.family}/${t.mechanism}`] || 0) + 1;
console.log('por mecanismo:', Object.entries(mechFails).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—');
// el detalle (puede traer datos reales) va a un archivo fuera del repo
fs.writeFileSync('evals/juez-fallas.json', JSON.stringify(fails.slice(0, 200).map(({ check, ...t }) => t), null, 1));
for (const t of fails.slice(0, showFails)) console.log(`  FALLA ${t.family}/${t.mechanism} · ${t.record || ''}`);

const hora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
fs.mkdirSync('evals', { recursive: true });
fs.appendFileSync('evals/juez-historial.jsonl', JSON.stringify({ hora, src, pasan: pass, total: tests.length, porcentaje: +(100 * pass / tests.length).toFixed(1), faciles: byDiff('fácil'), regulares: byDiff('regular'), dificiles: byDiff('difícil'), por_que_fallan: why, nota: arg('--nota', '') }) + '\n');
void stripAccents; void SECTOR; void firstRec;
