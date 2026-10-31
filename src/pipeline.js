// Pipeline completo: fuentes -> registro -> anonimización -> output/ (4 archivos).
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from './parse.js';
import { seedRegistry } from './seed.js';
import { Anonymizer } from './anon.js';
import { formatLike, h, hk } from './registry.js';
import { norm, digits } from './text.js';
import { SECTOR } from './catalog.js';

const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));

export function loadStored(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

/** Personas que aparecen sin ambigüedad en un texto: ids de cliente, correos y nombres completos únicos. */
function scanParticipants(an, text) {
  const out = new Set();
  const reg = an.reg;
  for (const m of text.matchAll(/(?:CL|PG)-\d{4,6}/g)) { const e = reg.byClient.get(m[0]); if (e) out.add(e); }
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/gi)) { const e = reg.byEmail.get(m[0].toLowerCase()); if (e) out.add(e); }
  const n = norm(text);
  for (const m of n.matchAll(an.rxNames)) {
    const c = an.forms.get(m[0].replace(/[\s_.\-]+/g, ' '));
    if (c && c.length === 1 && c[0].kind === 'full') out.add(c[0].e);
  }
  return out;
}

export function runPipeline({ srcDir, outDir, storedFile, log = () => {} }) {
  const t0 = Date.now();
  const all = loadAll(srcDir);
  const stored = storedFile ? loadStored(storedFile) : {};
  const reg = seedRegistry({ chats: all.chats, tables: all.tables }, stored);
  const an = new Anonymizer(reg);
  log(`registro: ${reg.entities.size} personas`);

  const threads = new Map();
  for (const r of all.chats.records) {
    if (!threads.has(r.thread_id)) threads.set(r.thread_id, []);
    threads.get(r.thread_id).push(r);
  }
  const threadState = new Map();
  const chatOut = [];
  for (const [tid, rs] of threads) chatOut.push(...anonThread(an, rs, threadState, tid));
  const docOut = all.docs.map(d => anonDoc(an, d));
  const tableOut = all.tables.records.map(rec => anonRow(an, rec));

  const entities = buildEntities(reg, an);
  const result = { chats: chatOut, docs: docOut, tables: tableOut, entities, reg, an, threads: threadState, recordIndex: all.recordIndex };
  if (outDir) writeOutput(outDir, result);
  if (storedFile) saveStored(storedFile, reg);
  result.seconds = (Date.now() - t0) / 1000;
  log(`pipeline: ${chatOut.length} chats · ${docOut.length} docs · ${tableOut.length} filas · ${entities.entities.length} entidades · ${result.seconds}s`);
  return result;
}


/** Anonimiza los mensajes de un hilo. threadState guarda los participantes por hilo para /anonymize. */
export function anonThread(an, rs, threadState, tid) {
  const reg = an.reg;
  const participants = threadState.get(tid) || new Set();
  threadState.set(tid, participants);
  for (const r of rs) {
    const e = r._user ? reg.byUid.get(r._user) : r._author;
    if (e) participants.add(e);
    for (const m of (r.text || '').matchAll(/<@([A-Z0-9]+)/g)) { const x = reg.byUid.get(m[1]); if (x) participants.add(x); }
    for (const x of scanParticipants(an, r.text || '')) participants.add(x);
  }
  const threadClients = [...participants].filter(e => e.role === 'cliente');
  const threadBlob = rs.map(r => r.text || '').join('\n');
  return rs.map(r => {
    const author = (r._user ? reg.byUid.get(r._user) : r._author) || null;
    const ctx = { recId: r.id, author, participants, threadClients, quasi: true, blob: threadBlob };
    let authorOut = r.author;
    if (author) {
      authorOut = an.renderName(author, r.author);
      an.touch(author, r.id, r.author, 'name', authorOut);
    } else if (r.author) authorOut = an.text(r.author, ctx);
    return {
      ...strip(r),
      author: authorOut,
      text: an.text(r.text || '', ctx),
      attachments: (r.attachments || []).map(a => ({ ...a, filename: an.text(a.filename || '', { ...ctx, filename: true }) })),
    };
  });
}

export function anonDoc(an, d) {
  const meta = d.metadata || {};
  const blob = [d.body, d.title, d.filename, ...Object.values(meta)].join('\n');
  const participants = scanParticipants(an, blob);
  const ctx = { recId: d.id, participants, linked: [], quasi: true, blob, internal: true };
  const metadata = {};
  for (const [k, v] of Object.entries(meta)) metadata[k] = an.text(String(v), ctx);
  return { ...d, filename: an.text(d.filename || '', { ...ctx, filename: true }), title: an.text(d.title || '', ctx), body: an.text(d.body || '', ctx), metadata };
}

export function anonRow(an, rec) {
  const reg = an.reg;
    const c = { ...rec.columns };
    const id = rec.id;
    const touchVal = (e, orig, type, val) => { an.touch(e, id, orig, type, val); };
    if (rec.table === 'clientes') {
      const e = reg.byClient.get(c.cliente_id);
      if (e) {
        const p = reg.pseudo(e);
        const full = an.renderName(e, c.nombre_completo);
        touchVal(e, c.nombre_completo, 'name', full);
        c.nombre_completo = full;
        if (c.num_doc) { touchVal(e, c.num_doc, 'cedula', p.cedula); c.num_doc = formatLike(p.cedula, c.num_doc); }
        if (c.correo) { const v = reg.pseudoEmail(e, c.correo); touchVal(e, c.correo, 'email', v); c.correo = v; }
        if (c.celular) { touchVal(e, c.celular, 'phone', p.phone); c.celular = formatLike(p.phone, c.celular); }
        if (c.direccion) { touchVal(e, c.direccion, 'address', p.address); c.direccion = p.address; }
        if (c.fecha_nacimiento) { touchVal(e, c.fecha_nacimiento, 'birth_iso', p.birth); c.fecha_nacimiento = p.birth; }
        if (c.barrio) c.barrio = pseudoBarrio(reg, e, c.barrio);
        if (c.ocupacion) c.ocupacion = SECTOR[c.ocupacion.toLowerCase()] || c.ocupacion;
        if (c.notas) c.notas = an.text(c.notas, { recId: id, linked: [e], participants: scanParticipants(an, c.notas), quasi: true });
      }
    } else if (rec.table === 'transacciones') {
      const e = reg.byClient.get(c.cliente_id);
      if (c.descripcion) c.descripcion = an.text(c.descripcion, { recId: id, linked: e ? [e] : [], quasi: true });
    } else if (rec.table === 'pqrs') {
      const e = reg.byClient.get(c.cliente_id);
      const ctx = { recId: id, linked: e ? [e] : [], author: e, participants: new Set(e ? [e] : []), quasi: true };
      if (c.cedula) {
        const ce = reg.byCedula.get(digits(c.cedula)) || e;
        if (ce) { const p = reg.pseudo(ce); touchVal(ce, c.cedula, 'cedula', p.cedula); c.cedula = formatLike(p.cedula, c.cedula); }
      }
      if (c.agente) {
        const ag = reg.byHandle.get(c.agente.toLowerCase());
        if (ag) { const v = reg.pseudoHandle(ag, c.agente); an.touch(ag, id, c.agente); c.agente = v; }
        else c.agente = an.text(c.agente, ctx);
      }
      for (const k of ['descripcion', 'respuesta']) if (c[k]) c[k] = an.text(c[k], ctx);
    } else if (rec.table === 'empleados') {
      const e = reg.byEmp.get(c.id);
      if (e) {
        const p = reg.pseudo(e);
        const full = an.renderName(e, c.nombre);
        touchVal(e, c.nombre, 'name', full);
        c.nombre = full;
        if (c.correo) { const v = reg.pseudoEmail(e, c.correo); touchVal(e, c.correo, 'email', v); c.correo = v; }
        if (c.celular) { touchVal(e, c.celular, 'phone', p.phone); c.celular = formatLike(p.phone, c.celular); }
        if (c.documento) { touchVal(e, c.documento, 'cedula', p.cedula); c.documento = formatLike(p.cedula, c.documento); }
        if (c.fecha_nacimiento) { touchVal(e, c.fecha_nacimiento, 'birth_iso', p.birth); c.fecha_nacimiento = p.birth; }
      }
      if (c.reporta_a) {
        const cands = (an.forms.get(norm(c.reporta_a)) || []).map(x => x.e).filter(x => x.role === 'empleado');
        const mgr = cands[0];
        if (mgr) { const v = an.renderName(mgr, c.reporta_a); an.touch(mgr, id, c.reporta_a, 'name', v); c.reporta_a = v; }
        else c.reporta_a = an.text(c.reporta_a, { recId: id });
      }
    } else {
      for (const k of Object.keys(c)) c[k] = an.text(c[k], { recId: id, quasi: true });
    }
    return { id, table: rec.table, columns: c };
}

function pseudoBarrio(reg, e, real) {
  const same = [...new Set([...reg.entities.values()].filter(x => x.city === e.city && x.barrio).map(x => x.barrio))].filter(b => b !== real).sort();
  if (!same.length) return real;
  return same[h(e.key, 'barrio') % same.length];
}

export function buildEntities(reg, an) {
  const out = [];
  let i = 0;
  for (const e of [...reg.entities.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (!e.records.size) continue;
    const pseudonyms = {};
    // nombre canónico = nombres + primer apellido (como la salida ideal), si se usó en algún registro
    const names = [...e.usedNames].sort((a, b) => b.length - a.length);
    const canon = e.p ? `${e.p.first.join(' ')} ${e.p.surnames[0]}` : null;
    if (canon && names.some(n => norm(n).includes(norm(canon)))) pseudonyms.name = canon;
    else if (names.length) pseudonyms.name = names[0];
    for (const [k, v] of Object.entries(e.used)) pseudonyms[k] = v;
    if (!Object.keys(pseudonyms).length) continue;
    const originals = new Set([...e.originals].filter(x => x && String(x).trim()));
    out.push({ entity_id: `p_${String(++i).padStart(3, '0')}`, key: e.key, type: 'person', originals: [...originals].sort(), pseudonyms, records: [...e.records].sort() });
  }
  let k = 0;
  for (const [name, recs] of an.keepEnts) {
    out.push({ entity_id: `kept_${String(++k).padStart(3, '0')}`, type: 'organization_or_place', originals: [name], pseudonyms: {}, kept: true, reason: 'organización, lugar, marca o figura pública; no es persona natural', records: [...recs].sort() });
  }
  return { entities: out };
}

export function writeOutput(dir, r) {
  fs.mkdirSync(dir, { recursive: true });
  const jl = rows => rows.map(x => JSON.stringify(x)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'chats.jsonl'), jl(r.chats));
  fs.writeFileSync(path.join(dir, 'docs.jsonl'), jl(r.docs));
  fs.writeFileSync(path.join(dir, 'tables.jsonl'), jl(r.tables));
  fs.writeFileSync(path.join(dir, 'entities.json'), JSON.stringify({ entities: r.entities.entities.map(({ key, ...x }) => x) }, null, 1));
}

export function saveStored(file, reg) {
  // el mapa solo crece: una persona que hoy no aparece conserva su seudónimo para cuando vuelva a aparecer
  const o = { ...loadStored(file), ...reg.stored };
  for (const e of reg.entities.values()) if (e.p) o[hk(e.key)] = e.p;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(o));
}
