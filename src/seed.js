// Siembra el registro con los maestros (clientes, empleados, usuarios de Slack) y resuelve
// a qué fila del maestro corresponde cada usuario cliente del chat.
import { Registry, Entity } from './registry.js';
import { norm, digits } from './text.js';
import { FEMALE, MALE } from './catalog.js';

function occGender(occ) {
  if (!occ) return null;
  const w = norm(occ).split(' ')[0];
  if (/(a)$/.test(w) && !/(ista|eta|ta)$/.test(w)) return 'F';
  if (/(o|or)$/.test(w)) return 'M';
  return null;
}

export function seedRegistry({ chats, tables }, stored = {}) {
  const reg = new Registry();
  reg.stored = stored;
  const clientes = tables.raw.clientes || [];
  const empleados = tables.raw.empleados || [];
  const users = chats.users || [];

  // 1. vocabulario real de nombres y apellidos
  const names = [...clientes.map(c => c.nombre_completo), ...empleados.map(e => e.nombre), ...users.map(u => u.real_name || '')].filter(Boolean);
  const catalogFirst = new Set([...FEMALE, ...MALE].map(norm));
  for (const n of names) {
    const t = n.trim().split(/\s+/).map(norm);
    reg.firstNames.add(t[0]);
    if (t.length === 2) reg.surnameSet.add(t[1]);
    if (t.length >= 4) { reg.firstNames.add(t[1]); reg.surnameSet.add(t[t.length - 2]); reg.surnameSet.add(t[t.length - 1]); }
    if (t.length === 3) reg.surnameSet.add(t[2]);
  }
  for (const n of names) {
    const t = n.trim().split(/\s+/).map(norm);
    if (t.length === 3 && !reg.surnameSet.has(t[1]) && (catalogFirst.has(t[1]) || reg.firstNames.has(t[1]))) reg.firstNames.add(t[1]);
    else if (t.length === 3) reg.surnameSet.add(t[1]);
  }

  // 2. clientes
  // un cliente migrado de Págalo llega con id nuevo (PG-…) y la misma cédula: es la misma persona y
  // conserva el seudónimo de su fila CL- (las filas CL- se siembran primero)
  const byDoc = new Map();
  for (const c of [...clientes].sort((a, b) => /^CL-/.test(b.cliente_id) - /^CL-/.test(a.cliente_id))) {
    const doc = c.num_doc ? digits(c.num_doc) : '';
    const prev = doc && byDoc.get(doc);
    if (prev) {
      prev.altClientIds.push(c.cliente_id);
      if (c.correo) prev.emails.add(c.correo.toLowerCase());
      if (c.celular) prev.phones.add(digits(c.celular));
      if (c.direccion) prev.addresses.add(c.direccion);
      if (c.fecha_nacimiento) prev.births.add(c.fecha_nacimiento);
      continue;
    }
    const e = reg.add(new Entity(`cl:${c.cliente_id}`, 'cliente'));
    e.altClientIds = [];
    if (doc) byDoc.set(doc, e);
    reg.setName(e, c.nombre_completo);
    e.clientId = c.cliente_id;
    if (c.num_doc) e.cedulas.add(digits(c.num_doc));
    if (c.correo) e.emails.add(c.correo.toLowerCase());
    if (c.celular) e.phones.add(digits(c.celular));
    if (c.direccion) e.addresses.add(c.direccion);
    if (c.fecha_nacimiento) e.births.add(c.fecha_nacimiento);
    e.city = c.ciudad; e.barrio = c.barrio; e.occupation = c.ocupacion;
    e.genderHint = occGender(c.ocupacion);
  }

  // 3. empleados
  for (const x of empleados) {
    const e = reg.add(new Entity(`emp:${x.id}`, 'empleado'));
    reg.setName(e, x.nombre);
    e.empId = x.id;
    if (x.documento) e.cedulas.add(digits(x.documento));
    if (x.correo) { e.emails.add(x.correo.toLowerCase()); e.handles.add(x.correo.split('@')[0].toLowerCase()); }
    if (x.celular) e.phones.add(digits(x.celular));
    if (x.fecha_nacimiento) e.births.add(x.fecha_nacimiento);
    e.city = x.ciudad;
    e.cargo = x.cargo;
    if (/a$/.test(norm(x.cargo || '').split(' ')[0]) && !/ista$/.test(norm(x.cargo || '').split(' ')[0])) e.genderHint = 'F';
  }

  // 4. usuarios de Slack
  const byEmail = new Map();
  for (const e of reg.entities.values()) for (const m of e.emails) byEmail.set(m, e);
  const byFull = new Map();
  for (const e of reg.entities.values()) {
    const k = norm(e.fullName);
    if (!byFull.has(k)) byFull.set(k, []);
    byFull.get(k).push(e);
  }
  const linked = new Set();
  const pending = [];
  for (const u of users) {
    if (u.is_bot) continue;
    const prof = u.profile || {};
    const email = (prof.email || '').toLowerCase();
    let e = email ? byEmail.get(email) : null;
    const isClient = (prof.title || '') === 'Cliente';
    if (!e) {
      const cands = (byFull.get(norm(u.real_name || '')) || []).filter(x => (isClient ? x.role === 'cliente' : x.role === 'empleado'));
      if (cands.length === 1 && !linked.has(cands[0].key)) e = cands[0];
    }
    if (!e) { pending.push(u); continue; }
    attachUser(e, u);
    linked.add(e.key);
  }

  // usuarios sin enlace directo: candidatos por prefijo de nombre + evidencia en sus mensajes
  const textsByUser = new Map();
  const threadOf = new Map();
  for (const r of chats.records) {
    if (!textsByUser.has(r._user)) textsByUser.set(r._user, []);
    textsByUser.get(r._user).push(r.text);
    if (!threadOf.has(r.thread_id)) threadOf.set(r.thread_id, []);
    threadOf.get(r.thread_id).push(r);
  }
  const threadsOfUser = new Map();
  for (const [tid, rs] of threadOf) for (const r of rs) {
    if (!threadsOfUser.has(r._user)) threadsOfUser.set(r._user, new Set());
    threadsOfUser.get(r._user).add(tid);
  }
  // evidencia que liga un usuario con una fila del maestro (para homónimos): lo que el propio usuario
  // escribe vale más que lo que dice el hilo; radicados PQR y montos de transacción apuntan al cliente.
  const pqrClient = new Map((tables.raw.pqrs || []).map(p => [p.radicado, p.cliente_id]));
  const txByClient = new Map();
  for (const t of tables.raw.transacciones || []) {
    if (!txByClient.has(t.cliente_id)) txByClient.set(t.cliente_id, new Set());
    txByClient.get(t.cliente_id).add(String(t.monto));
  }
  const evidence = (u, x) => {
    const own = (textsByUser.get(u.id) || []).join('\n');
    const blob = [...(threadsOfUser.get(u.id) || [])].flatMap(t => threadOf.get(t).map(r => r.text)).join('\n');
    let s = 0;
    for (const [txt, w] of [[own, 3], [blob, 1]]) {
      const compact = txt.replace(/(?<=\d)[ .\-](?=\d)/g, '');
      const low = txt.toLowerCase();
      for (const c of x.cedulas) if (compact.includes(c)) s += 40 * w;
      for (const p of x.phones) if (compact.includes(p)) s += 40 * w;
      for (const m of x.emails) if (low.includes(m)) s += 40 * w;
      if (x.clientId && txt.includes(x.clientId)) s += 40 * w;
      for (const m of txt.matchAll(/PQR-\d{4}-\d{3,5}/g)) if (pqrClient.get(m[0]) === x.clientId) s += 25 * w;
      const amounts = new Set([...txt.matchAll(/\d{1,3}(?:\.\d{3})+/g)].map(m => m[0].replace(/\./g, '')));
      for (const a of amounts) if (txByClient.get(x.clientId)?.has(a)) s += 10 * w;
      const nlow = norm(txt);
      if (x.barrio && nlow.includes(norm(x.barrio))) s += 6 * w;
      if (x.city && nlow.includes(norm(x.city))) s += 3 * w;
      if (x.occupation && nlow.includes(norm(x.occupation).slice(0, 7))) s += 4 * w;
    }
    return s;
  };

  // homónimos: todos los usuarios ambiguos contra todas sus candidatas, se asignan primero los pares con más evidencia
  const ambiguous = [];
  for (const u of pending) {
    if (!u.real_name) continue;
    const isClient = (u.profile?.title || '') === 'Cliente';
    const ut = norm(u.real_name).split(' ');
    const cands = [...reg.entities.values()].filter(x => (isClient ? x.role === 'cliente' : x.role === 'empleado') && !linked.has(x.key))
      .filter(x => { const xt = norm(x.fullName).split(' '); return ut.every((t, i) => xt[i] === t) || (ut.length === 2 && xt[0] === ut[0] && xt.slice(1).includes(ut[1])); });
    if (cands.length > 1) for (const x of cands) ambiguous.push({ u, x, s: evidence(u, x) });
  }
  ambiguous.sort((a, b) => b.s - a.s);
  const doneUsers = new Set();
  for (const { u, x } of ambiguous) {
    if (doneUsers.has(u.id) || linked.has(x.key)) continue;
    attachUser(x, u);
    linked.add(x.key);
    doneUsers.add(u.id);
  }

  for (const u of pending) {
    if (doneUsers.has(u.id)) continue;
    const prof = u.profile || {};
    // usuario desactivado o sin nombre: se liga por lo que él mismo escribe (cédula, celular, correo, "soy Nombre")
    if (!u.real_name && !prof.real_name) {
      const own = (textsByUser.get(u.id) || []).join('\n');
      const compact = own.replace(/(?<=\d)[ .\-](?=\d)/g, '');
      let hit = [...reg.entities.values()].find(x => !linked.has(x.key) && (
        [...x.cedulas, ...x.phones].some(d => d.length >= 7 && compact.includes(d)) ||
        [...x.emails].some(m => own.toLowerCase().includes(m)) ||
        (x.clientId && own.includes(x.clientId))));
      if (!hit) {
        const intro = own.match(/(?:soy|me llamo|mi nombre es)\s+(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+){1,3})/u);
        if (intro) hit = [...reg.entities.values()].find(x => !linked.has(x.key) && norm(x.fullName).startsWith(norm(intro[1])));
      }
      if (hit) { attachUser(hit, { ...u, name: null }); linked.add(hit.key); continue; }
    }
    const isClient = (prof.title || '') === 'Cliente';
    const ut = norm(u.real_name || '').split(' ');
    let cands = [...reg.entities.values()].filter(x => (isClient ? x.role === 'cliente' : x.role === 'empleado') && !linked.has(x.key))
      .filter(x => { const xt = norm(x.fullName).split(' '); return ut.every((t, i) => xt[i] === t) || (ut.length === 2 && xt[0] === ut[0] && xt.slice(1).includes(ut[1])); });
    if (cands.length > 1) {
      // evidencia: cédula, celular, correo o id de cliente escritos en los hilos donde participa
      const blob = [...(threadsOfUser.get(u.id) || [])].flatMap(t => threadOf.get(t).map(r => r.text)).join('\n');
      const bd = digits(blob.replace(/[^\d\n ]/g, ''));
      const compact = blob.replace(/(?<=\d)[ .\-](?=\d)/g, '');
      const scored = cands.map(x => {
        let s = 0;
        for (const c of x.cedulas) if (compact.includes(c)) s += 10;
        for (const p of x.phones) if (compact.includes(p)) s += 10;
        for (const m of x.emails) if (blob.toLowerCase().includes(m)) s += 10;
        if (x.clientId && blob.includes(x.clientId)) s += 10;
        if (x.city && blob.includes(x.city)) s += 1;
        return { x, s };
      }).sort((a, b) => b.s - a.s);
      if (scored[0].s > (scored[1]?.s ?? -1)) cands = [scored[0].x];
      void bd;
    }
    let e = cands[0];
    if (!e) {
      e = reg.add(new Entity(`usr:${u.id}`, isClient ? 'cliente' : 'empleado'));
      reg.setName(e, u.real_name || u.name || u.id);
    }
    attachUser(e, u);
    linked.add(e.key);
  }

  reg.pqrClient = pqrClient;
  reg.txClient = new Map((tables.raw.transacciones || []).map(t => [t.tx_id, t.cliente_id]));
  for (const e of reg.entities.values()) reg.index(e);
  reg.build();
  return reg;
}

function attachUser(e, u) {
  const prof = u.profile || {};
  e.uids.add(u.id);
  if (u.name) e.handles.add(u.name.toLowerCase());
  if (u.real_name && norm(u.real_name) !== norm(e.fullName)) e.extraNames.add(u.real_name);
  if (prof.display_name && prof.display_name.includes(' ')) e.extraNames.add(prof.display_name);
  // apodo de una sola palabra distinto del nombre de pila ("Pipe" para Felipe): sirve solo en contexto
  if (prof.display_name && !prof.display_name.includes(' ') && e.tokens.length && norm(prof.display_name) !== norm(e.tokens[0])) (e.nicknames ||= new Set()).add(norm(prof.display_name));
  if (prof.email) e.emails.add(prof.email.toLowerCase());
  if (prof.phone) e.phones.add(digits(prof.phone));
  e.slackName = u.real_name;
}
