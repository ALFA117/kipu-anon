// /anonymize: registros nuevos con el mismo registro de identidades de la última corrida.
import { anonThread, anonDoc, anonRow, buildEntities } from './pipeline.js';
import { Entity } from './registry.js';
import { norm, digits } from './text.js';

function strongHint(text) {
  const m = (text || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || (text || '').match(/\d[\d.\s-]{5,}\d/);
  return m ? (m[0].includes('@') ? m[0].toLowerCase() : digits(m[0])) : '';
}

/** Persona autora de un mensaje en vivo: por nombre, desempatando con llaves fuertes del texto o del hilo. */
function resolveAuthor(an, r, threadPeople) {
  const reg = an.reg;
  if (!r.author || /^kipi$/i.test(r.author)) return null;
  const text = r.text || '';
  // una llave fuerte conocida en el texto del autor manda
  const compact = text.replace(/(?<=\d)[ .\-](?=\d)/g, '');
  const cands = (an.forms.get(norm(r.author)) || []).map(x => x.e);
  for (const e of cands) {
    if ([...e.cedulas, ...e.phones].some(d => compact.includes(d))) return e;
    if ([...e.emails].some(m => text.toLowerCase().includes(m))) return e;
  }
  if (cands.length === 1) {
    const hint = strongHint(text);
    const owner = hint && (reg.byCedula.get(hint) || reg.byEmail.get(hint) || reg.byPhone.get(hint));
    // mismo nombre con la llave fuerte de OTRA persona: es esa otra persona
    if (owner && owner !== cands[0]) return owner;
    // mismo nombre con OTRA cédula: nadie tiene dos cédulas, es una persona distinta (homónima).
    // Un correo o celular nuevo sí puede ser la misma persona.
    const isCedula = hint && !hint.includes('@') && !/^3\d{9}$/.test(hint) && hint.length >= 6;
    if (isCedula && !owner && cands[0].cedulas.size && !cands[0].cedulas.has(hint)) {
      const e = reg.newTercero(r.author, hint);
      e.cedulas.add(hint); reg.byCedula.set(hint, e);
      an.addForms(e);
      return e;
    }
    return cands[0];
  }
  if (cands.length > 1) {
    const inThread = cands.filter(e => threadPeople?.has(e));
    if (inThread.length) return inThread[0];
    return an.pick(cands, { participants: threadPeople }, 0, text);
  }
  // persona nueva: dos personas nuevas con el mismo nombre se separan por su llave fuerte
  const hint = strongHint(text);
  if (hint) {
    const owner = reg.byCedula.get(hint) || reg.byEmail.get(hint) || reg.byPhone.get(hint);
    if (owner) return owner;
  }
  // la misma persona nueva en otro lote reusa su ficha; una homónima con otra llave fuerte es otra persona
  const base = `ter:${norm(r.author)}`;
  const same = [...reg.entities.values()].filter(e => e.key === base || e.key.startsWith(`${base}|`));
  let e = null;
  if (same.length && !hint) e = same[0];
  else if (same.length) e = same.find(x => !x.cedulas.size && !x.emails.size && !x.phones.size) || null;
  if (!e) e = reg.newTercero(r.author, same.length ? hint : '');
  if (hint) {
    if (hint.includes('@')) { e.emails.add(hint); reg.byEmail.set(hint, e); }
    else if (/^3\d{9}$/.test(hint)) { e.phones.add(hint); reg.byPhone.set(hint, e); }
    else { e.cedulas.add(hint); reg.byCedula.set(hint, e); }
  }
  an.addForms(e);
  return e;
}

function ensureRowEntity(an, rec) {
  const reg = an.reg;
  const c = rec.columns || {};
  if (rec.table === 'clientes' && c.cliente_id && !reg.byClient.get(c.cliente_id)) {
    const e = reg.add(new Entity(`cl:${c.cliente_id}`, 'cliente'));
    reg.setName(e, c.nombre_completo || c.cliente_id);
    e.clientId = c.cliente_id;
    if (c.num_doc) e.cedulas.add(digits(c.num_doc));
    if (c.correo) e.emails.add(c.correo.toLowerCase());
    if (c.celular) e.phones.add(digits(c.celular));
    if (c.direccion) e.addresses.add(c.direccion);
    if (c.fecha_nacimiento) e.births.add(c.fecha_nacimiento);
    e.city = c.ciudad; e.barrio = c.barrio; e.occupation = c.ocupacion;
    reg.index(e);
    reg.pseudo(e);
    an.addForms(e);
  }
  if (rec.table === 'empleados' && c.id && !reg.byEmp.get(c.id)) {
    const e = reg.add(new Entity(`emp:${c.id}`, 'empleado'));
    reg.setName(e, c.nombre || c.id);
    e.empId = c.id;
    if (c.documento) e.cedulas.add(digits(c.documento));
    if (c.correo) e.emails.add(c.correo.toLowerCase());
    if (c.celular) e.phones.add(digits(c.celular));
    reg.index(e);
    reg.pseudo(e);
    an.addForms(e);
  }
}

export function anonymizeBatch(state, source, records) {
  const { an } = state;
  const reg = an.reg;
  const ids = new Set(records.map(r => r.id));
  let out;
  if (source === 'chats') {
    const byThread = new Map();
    for (const r of records) {
      const tid = r.thread_id || `live:${r.id}`;
      if (!byThread.has(tid)) byThread.set(tid, []);
      byThread.get(tid).push(r);
    }
    const res = new Map();
    for (const [tid, rs] of byThread) {
      const people = state.threads.get(tid) || new Set();
      const prepared = rs.map(r => ({ ...r, _author: resolveAuthor(an, r, people) }));
      anonThread(an, prepared, state.threads, tid).forEach((o, i) => res.set(rs[i].id, o));
    }
    out = records.map(r => res.get(r.id));
  } else if (source === 'docs') {
    out = records.map(d => anonDoc(an, d));
  } else {
    out = records.map(rec => { ensureRowEntity(an, rec); return anonRow(an, { ...rec, columns: { ...(rec.columns || {}) } }); });
  }
  // La respuesta solo declara las formas reales que venían en ESTE lote y solo los registros de este lote:
  // nunca devuelve datos del corpus que el que llama no mandó (cédula, celular o nacimiento de otra persona).
  const sent = norm(records.map(r => JSON.stringify(r)).join('\n'));
  const sentDigits = sent.replace(/(?<=\d)[ .\-](?=\d)/g, '');
  const entities = buildEntities(reg, an).entities
    .filter(e => e.records.some(id => ids.has(id)))
    .map(({ key, ...e }) => ({
      ...e,
      originals: e.originals.filter(o => (/^[\d .\-]+$/.test(o) ? sentDigits.includes(o.replace(/\D/g, '')) : sent.includes(norm(o)))),
      records: e.records.filter(id => ids.has(id)),
    }));
  return { records: out, entities };
}
