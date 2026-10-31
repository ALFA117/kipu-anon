// Simula el incidente («Kipu Pay compró Págalo») sin esperar al API: copia raw/full a raw/sim y le agrega
// un canal nuevo, una fecha nueva en un canal viejo, dos documentos y filas nuevas en las 4 tablas, con
// personas INVENTADAS (nuevas, un homónimo de una clienta vieja, un tercero) y un cliente viejo que llega
// con correo y celular nuevos. Luego corre el pipeline con una copia del mapa persistido y revisa:
//   1. que las personas de la salida de referencia conserven exactamente sus seudónimos,
//   2. que ningún dato inventado se escape (normalización del juez),
//   3. que las personas nuevas reciban seudónimos nuevos, únicos y distintos del real,
//   4. homónimo separado y cliente viejo con identificador nuevo ligado a su ficha,
//   5. salida uno a uno y validador oficial.
// No llama al servicio desplegado ni gasta corridas.
// uso: node scripts/simular-incidente.js [salida-de-referencia/entities.json]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPipeline } from '../src/pipeline.js';
import { contiene } from './judge-text.js';

const SRC = 'raw/full', SIM = 'raw/sim', OUT = 'evals/out_sim';
const refFile = process.argv[2] || 'output/entities.json';
fs.rmSync(SIM, { recursive: true, force: true });
fs.cpSync(SRC, SIM, { recursive: true });
const J = f => JSON.parse(fs.readFileSync(path.join(SIM, f), 'utf8'));
const W = (f, o) => fs.writeFileSync(path.join(SIM, f), typeof o === 'string' ? o : JSON.stringify(o, null, 1));
const latin = f => Buffer.from(fs.readFileSync(path.join(SIM, f))).toString('latin1');

// ── personas viejas tomadas de las fuentes (no se escriben en el script) ──
const users = J('chats/users.json');
const cliRows = latin('tables/clientes.csv').trim().split(/\r?\n/).map(l => l.split(';'));
const head = cliRows[0], cli = cliRows.slice(1).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
const old = users.find(u => u.profile?.title === 'Cliente' && u.profile.email && cli.some(c => c.correo === u.profile.email));
const oldRow = cli.find(c => c.correo === old.profile.email);
const twin = cli.find(c => c !== oldRow && /a$/.test(c.nombre_completo.split(' ')[0]));
const agent = users.find(u => /kipupay\.co$/.test(u.profile?.email || '') && /agente|analista/i.test(u.profile?.title || ''));
const empXml = fs.readFileSync(path.join(SIM, 'tables/empleados.xml'), 'utf8');
const manager = empXml.match(/<nombre>([^<]+)<\/nombre>/)[1];
const first = s => s.split(' ')[0];

// ── personas inventadas ──
const N1 = { name: 'Mariana Quiceno Ibargüen', cc: '1087654321', cel: '3176540921', mail: 'mquiceno.pagalo@gmail.com', dir: 'Calle 44 # 12-30 apto 502', nac: '1991-03-14' };
const N2 = { name: 'Óscar Iván Tabares Lozano', cc: '79845123', cel: '3012228844', mail: 'otabares@outlook.com', dir: 'Carrera 7 # 82-15', nac: '1984-07-22' };
const N3 = { name: twin.nombre_completo, cc: '1144778899', cel: '3157771122', mail: 'nueva.pagalo2026@yahoo.com', dir: 'Transversal 5 # 3-21', nac: '1999-12-01' };
const N4 = { name: 'Yuliana Restrepo Galvis', cc: '1037612345', cel: '3104567788', mail: 'yuliana.restrepo@kipupay.co', nac: '1993-11-02' };
const N5 = { name: 'Hernando Ceballos' };
const OLDNEW = { mail: 'o.nuevo2026@protonmail.com', cel: '3209876543' };

// ── chats: canal nuevo y fecha nueva en canal viejo ──
const ch = J('chats/channels.json');
ch.push({ id: 'C0PAGALO1', name: 'pagalo-migracion', created: 1792000000, creator: agent.id, is_archived: false, is_shared: true, members: [agent.id, old.id, 'U0PAGAL01', 'U0PAGAL02', 'U0PAGAL03'] });
W('chats/channels.json', ch);
const nu = (id, p, title = 'Cliente') => ({ id, team_id: 'T0KIPU0001', name: p.mail.split('@')[0], real_name: p.name, is_bot: false, is_restricted: title === 'Cliente', tz: 'America/Bogota', profile: { real_name: p.name, display_name: first(p.name), title, email: p.mail } });
users.push(nu('U0PAGAL01', N1), nu('U0PAGAL02', N2), nu('U0PAGAL03', N3));
W('chats/users.json', users);
let n = 0;
const msg = (user, text, ts, thread) => ({ type: 'message', user, text, ts: `${ts}.00${String(++n).padStart(2, '0')}00`, client_msg_id: `5a1a0000-0000-4000-8000-${String(n).padStart(12, '0')}`, team: 'T0KIPU0001', ...(thread ? { thread_ts: thread, parent_user_id: null } : {}) });
const t0 = 1792050000, th = `${t0}.000100`;
n = 0;
const day1 = [
  msg('U0PAGAL01', `Buenas, soy Mariana Quiceno, venía de Págalo. Mi cédula es 1.087.654.321 y mi correo mquiceno.pagalo arroba gmail punto com. No me aparece el crédito.`, t0),
  msg(agent.id, `Hola Mariana, ya te ubico como CL-70001. ¿Confirmas tu celular 317 654 0921 y la dirección ${N1.dir}?`, t0 + 60, th),
  msg('U0PAGAL01', `Sí. Nací el 14 de marzo de 1991. Mi codeudor es ${N5.name}, por si lo llaman.`, t0 + 120, th),
  msg('U0PAGAL02', `Yo soy Óscar Iván Tabares, cédula ${N2.cc}, celular ${N2.cel}, ${N2.mail}. Págalo me cobró doble la cuota de octubre.`, t0 + 300),
  msg('U0PAGAL03', `Hola, me llamo ${N3.name}, clienta nueva de Págalo, CC ${N3.cc}. ¿Mis datos ya se migraron?`, t0 + 600),
  msg(agent.id, `${first(N3.name)}, sí, quedaste como CL-70003. No eres la misma persona de ${oldRow.cliente_id === twin.cliente_id ? '' : twin.cliente_id}, tranquila.`, t0 + 660, `${t0 + 600}.000500`),
  msg(old.id, `Hola, soy ${oldRow.nombre_completo}. Cambié de correo: ahora es ${OLDNEW.mail} y mi celular nuevo es ${OLDNEW.cel}.`, t0 + 900),
  msg(agent.id, `Listo ${first(oldRow.nombre_completo)}, actualizado en ${oldRow.cliente_id}. La migración la coordina ${N4.name} (${N4.mail}).`, t0 + 960, `${t0 + 900}.000700`),
];
fs.mkdirSync(path.join(SIM, 'chats/pagalo-migracion'), { recursive: true });
W('chats/pagalo-migracion/2026-10-20.json', day1);
const day2 = [msg(old.id, `Ya me llegó el extracto al correo nuevo. Mi cédula sigue siendo ${oldRow.num_doc}.`, t0 + 86400)];
W('chats/soporte-cobros/2026-10-21.json', day2);

// ── documentos nuevos ──
const di = J('docs/index.json');
di.push({ id: 'doc_27', filename: 'acta_migracion_pagalo.md', format: 'md' }, { id: 'doc_28', filename: 'carta_bienvenida_mariana_quiceno.html', format: 'html' });
W('docs/index.json', di);
W('docs/acta_migracion_pagalo.md', `---\nautor: ${N4.name}\n---\n# Acta de migración Págalo\n\nAsistentes: ${N4.name} (Págalo), ${manager}.\n\n| Cliente | Nombre | Cédula | Correo |\n|---|---|---|---|\n| CL-70001 | ${N1.name.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '')} | 1087654321 | ${N1.mail} |\n| CL-70002 | ${N2.name} | 79.845.123 | ${N2.mail} |\n\nCaso especial: ${N3.name} (CL-70003, CC ${N3.cc}) no es ${twin.nombre_completo} (${twin.cliente_id}). Contacto de Yuliana: ${N4.cel}.\n`);
W('docs/carta_bienvenida_mariana_quiceno.html', `<html><head><title>Bienvenida</title><meta name="author" content="${N4.name}"></head><body><!-- revisó: Yuliana Restrepo --><p>Estimada ${N1.name}:</p><p>Bienvenida a Kipu Pay. Tu crédito de Págalo quedó migrado a la cuenta CL-70001. Te escribimos a ${N1.mail} y al ${N1.cel}.</p><p>Cordialmente,<br>Yuliana R.</p></body></html>`);

// ── tablas ──
const row = (id, p, ciudad, barrio, ocup) => [id, p.name, 'CC', p.cc, p.mail, p.cel, ciudad, barrio, p.dir, p.nac, '2026-10-20', ocup, 'Migrado de Págalo'].join(';');
fs.appendFileSync(path.join(SIM, 'tables/clientes.csv'), Buffer.from([row('CL-70001', N1, 'Pereira', 'Álamos', 'docente'), row('CL-70002', N2, 'Bogotá', 'Chapinero', 'contador'), row('CL-70003', N3, 'Cali', 'San Fernando', 'enfermera')].join('\n') + '\n', 'latin1'));
fs.appendFileSync(path.join(SIM, 'tables/transacciones.csv'), [
  'TX-006031,2026-10-20,CL-70001,pago_credito,310000,Cuota crédito Págalo migrado,pse,aprobada',
  'TX-006032,2026-10-20,CL-70002,pago_credito,450000,Cuota doble Págalo,pse,reversada',
  `TX-006033,2026-10-21,${oldRow.cliente_id},compra,89000,Compra en Carulla,tarjeta,aprobada`,
].join('\n') + '\n');
let pq = fs.readFileSync(path.join(SIM, 'tables/pqrs.xml'), 'utf8');
pq = pq.replace('</pqrs>', `  <pqr radicado="PQR-2026-0901" cliente_id="CL-70002" cedula="${N2.cc}" ciudad="Bogotá" fecha="2026-10-20" agente="${agent.name}" tipo="reclamo" estado="abierto">\n    <descripcion><![CDATA[Soy ${N2.name}. Págalo me cobró doble la cuota; escríbanme a ${N2.mail}.]]></descripcion>\n    <respuesta>Se escala a ${N4.name} para revisar la migración.</respuesta>\n  </pqr>\n</pqrs>`);
W('tables/pqrs.xml', pq);
let em = empXml.replace('</empleados>', `  <empleado id="KP-037" cargo="Coordinadora de migración" ciudad="Bogotá" ingreso="2026" reporta_a="${manager.split(' ').slice(0, 2).join(' ')}">\n    <nombre>${N4.name}</nombre>\n    <correo>${N4.mail}</correo>\n    <celular>${N4.cel}</celular>\n    <documento tipo="CC">${N4.cc}</documento>\n    <fecha_nacimiento>${N4.nac}</fecha_nacimiento>\n  </empleado>\n</empleados>`);
W('tables/empleados.xml', em);
const ti = J('tables/index.json');
for (const t of ti) t.rows += { 'clientes.csv': 3, 'transacciones.csv': 3, 'pqrs.xml': 1, 'empleados.xml': 1 }[t.name] || 0;
W('tables/index.json', ti);
const ri = J('record_index.json');
ri.chats.push(...day1.map(m => m.client_msg_id), ...day2.map(m => m.client_msg_id));
ri.docs.push('doc_27', 'doc_28');
ri.tables.push('clientes:CL-70001', 'clientes:CL-70002', 'clientes:CL-70003', 'transacciones:TX-006031', 'transacciones:TX-006032', 'transacciones:TX-006033', 'pqrs:PQR-2026-0901', 'empleados:KP-037');
W('record_index.json', ri);

// ── pipeline con copia del mapa persistido ──
fs.rmSync(OUT, { recursive: true, force: true });
fs.copyFileSync('data/pseudonyms.json', 'evals/pseudonyms.sim.tmp.json');
const r = runPipeline({ srcDir: SIM, outDir: OUT, storedFile: 'evals/pseudonyms.sim.tmp.json' });
fs.rmSync('evals/pseudonyms.sim.tmp.json', { force: true });
const ok = [], bad = [];
const check = (cond, label) => (cond ? ok : bad).push(label);

// 1. estabilidad contra la salida de referencia (por formas originales compartidas)
const ents = r.entities.entities.filter(e => !e.kept);
const ref = JSON.parse(fs.readFileSync(refFile, 'utf8')).entities.filter(e => !e.kept);
const byOrig = new Map();
for (const e of ents) for (const o of e.originals) (byOrig.get(o) || byOrig.set(o, []).get(o)).push(e);
let same = 0;
const moved = [];
for (const a of ref) {
  const c = new Map();
  for (const o of a.originals) for (const b of byOrig.get(o) || []) c.set(b, (c.get(b) || 0) + 1);
  const b = [...c].sort((x, y) => y[1] - x[1])[0]?.[0];
  const diff = b ? Object.entries(a.pseudonyms).filter(([k, v]) => b.pseudonyms[k] !== undefined && b.pseudonyms[k] !== v) : [['sin pareja', a.entity_id]];
  if (diff.length) moved.push(`${a.entity_id} ${diff.map(([k, v]) => `${k}:${v}→${b?.pseudonyms[k]}`).join(' ')}`); else same++;
}
check(!moved.length, `estabilidad: ${same}/${ref.length} personas de antes con el mismo seudónimo`);

// 2. fuga de datos inventados (y de los datos viejos en los registros nuevos)
const newIds = new Set([...ri.chats.slice(-day1.length - day2.length), 'doc_27', 'doc_28', ...ri.tables.slice(-8)]);
const recs = [...r.chats, ...r.docs, ...r.tables].filter(x => newIds.has(x.id));
check(recs.length === newIds.size, `registros nuevos en la salida: ${recs.length}/${newIds.size}`);
const blob = recs.map(x => JSON.stringify(x)).join('\n');
const pii = [];
for (const p of [N1, N2, N3, N4]) {
  const w = p.name.split(' ');
  pii.push(p.name, `${w[0]} ${w[w.length - 2] || w[1]}`, p.cc, p.cel, p.mail, p.dir, p.nac);
}
pii.push(N5.name, OLDNEW.mail, OLDNEW.cel, '14 de marzo de 1991', oldRow.nombre_completo, oldRow.num_doc, oldRow.correo, twin.nombre_completo, 'Yuliana Restrepo', 'Yuliana R');
const leaks = pii.filter(Boolean).filter(v => recs.some(x => contiene(JSON.stringify(x), v)));
check(!leaks.length, `fuga en registros nuevos: ${leaks.length} de ${pii.filter(Boolean).length} datos`);
for (const v of leaks) {
  const where = recs.find(x => contiene(JSON.stringify(x), v));
  bad.push(`   · «${v}» en ${where.id}`);
}

// 3. personas nuevas: seudónimo propio, único, distinto del real
const entOf = v => ents.find(e => e.originals.includes(v));
const names = new Map();
for (const e of ents) if (e.pseudonyms.name) names.set(e.pseudonyms.name, (names.get(e.pseudonyms.name) || 0) + 1);
for (const p of [N1, N2, N4]) {
  const e = entOf(p.cc) || entOf(p.name);
  check(e && e.pseudonyms.name && e.pseudonyms.name !== p.name && names.get(e.pseudonyms.name) === 1, `persona nueva ${first(p.name)}: ${e ? e.pseudonyms.name : 'SIN ENTIDAD'}`);
}
check(!!entOf(N5.name), `tercero nuevo (codeudor) declarado: ${entOf(N5.name)?.pseudonyms.name || 'no'}`);

// 4. homónimo y cliente viejo con identificadores nuevos
const eTwin = entOf(twin.num_doc), eNew = entOf(N3.cc);
check(eTwin && eNew && eTwin !== eNew && eTwin.pseudonyms.name !== eNew.pseudonyms.name, `homónima nueva separada: vieja ${eTwin?.pseudonyms.name} · nueva ${eNew?.pseudonyms.name}`);
const eOld = entOf(oldRow.num_doc);
check(eOld && entOf(OLDNEW.mail) === eOld && entOf(OLDNEW.cel) === eOld, `cliente viejo con correo/celular nuevos ligado a su ficha (${eOld?.pseudonyms.name})`);

// 5. uno a uno + validador oficial
const total = r.chats.length + r.docs.length + r.tables.length;
check(total === ri.chats.length + ri.docs.length + ri.tables.length, `uno a uno: ${total} registros`);
const val = spawnSync(process.execPath, ['scripts/validar.mjs', OUT, '--public', SIM], { encoding: 'utf8' });
check(/OK: la salida pasa el validador/.test(val.stdout), 'validador oficial');

console.log(`simulación del incidente · ${r.chats.length} chats · ${r.docs.length} docs · ${r.tables.length} filas · ${r.seconds}s`);
for (const l of ok) console.log('  ✔ ' + l);
for (const l of bad) console.log('  ✘ ' + l);
if (moved.length) console.log(moved.slice(0, 20).map(x => '     ' + x).join('\n'));
if (!/OK/.test(val.stdout)) console.log(val.stdout.slice(-1500));
process.exitCode = bad.length ? 1 : 0;
