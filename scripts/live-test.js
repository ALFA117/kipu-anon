// Imita las pruebas en vivo del jurado contra /anonymize: persona conocida, persona nueva,
// homónimos nuevos, homónimas del maestro, solo identificadores, lotes de 50 y registros raros.
// uso: node scripts/live-test.js <base-url-con-/v1> <output/>   (o importar runLiveCases)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runLiveCases(callApi, out = 'output', clientesCsv = 'raw/full/tables/clientes.csv', quiet = false) {
const ents = JSON.parse(fs.readFileSync(path.join(out, 'entities.json'), 'utf8')).entities;
const tables = fs.readFileSync(path.join(out, 'tables.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const byOrig = f => ents.find(e => e.originals.includes(f));

const call = callApi;
const chat = (id, text, author = '', thread = `live:${id}`) => ({ id, thread_id: thread, author, ts: '1792000000.000100', text, attachments: [] });
let ok = 0, total = 0;
const fails = [];
const check = (name, cond, extra = '') => { total++; if (cond) ok++; else fails.push(name); if (!quiet) console.log(`${cond ? 'PASA ' : 'FALLA'} ${name} ${extra}`); };

// clientes reales del maestro (lado original) para armar casos
const raw = fs.readFileSync(clientesCsv, 'latin1').split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(';'));
const pick = raw[7];
const [cid, fullName, , cedula, correo, celular] = pick;
const known = byOrig(cedula) || byOrig(fullName);
const knownName = known?.pseudonyms?.name;

// 1. persona conocida por nombre completo
let r = await call('chats', [chat('k1', `Hola, soy ${fullName}. Necesito el paz y salvo.`, fullName)]);
check('conocida por nombre → mismo seudónimo', r.status === 200 && r.json.records[0].text.includes(knownName) && !r.json.records[0].text.includes(fullName), `${r.status} ${r.ms}ms "${r.json?.records?.[0]?.text}"`);
// 2. conocida solo por cédula y correo
r = await call('chats', [chat('k2', `Mi cédula es ${cedula} y mi correo ${correo}`, '')]);
check('conocida por cédula → su cédula falsa', r.status === 200 && r.json.records[0].text.includes(known.pseudonyms.cedula?.slice(-4) || '#') && !r.json.records[0].text.includes(cedula), `${r.status} "${r.json?.records?.[0]?.text}"`);
// 3. persona nueva con correo, cédula, celular y placa
r = await call('chats', [chat('n1', 'Hola, me llamo Rigoberto Quiñones Ballesteros, CC 1.045.778.213, correo rquinones@gmail.com, cel 315 778 2231, placa XKD-482.', 'Rigoberto Quiñones Ballesteros')]);
const t3 = r.json?.records?.[0]?.text || '';
check('nueva con datos → sin error y sin fuga', r.status === 200 && !/Rigoberto|Quiñones|1\.045\.778\.213|rquinones|315 778 2231|XKD-482/.test(t3), `${r.status} "${t3}"`);
// 4. dos personas nuevas con el mismo nombre y distinta cédula → dos seudónimos
r = await call('chats', [chat('h1', 'Soy Wilmar Restrepo Ochoa, cédula 71.555.302', 'Wilmar Restrepo Ochoa', 'a:1'), chat('h2', 'Soy Wilmar Restrepo Ochoa, cédula 98.443.120', 'Wilmar Restrepo Ochoa', 'b:1')]);
const a1 = r.json?.records?.[0]?.author, a2 = r.json?.records?.[1]?.author;
check('homónimos nuevos → dos seudónimos', r.status === 200 && a1 && a2 && a1 !== a2, `${a1} / ${a2}`);
// 5. persona nueva repetida en otro lote → mismo seudónimo
r = await call('chats', [chat('n2', 'Otra vez yo, Rigoberto Quiñones Ballesteros. ¿Ya quedó?', 'Rigoberto Quiñones Ballesteros')]);
check('nueva repetida → mismo seudónimo que antes', r.status === 200 && r.json.records[0].author && t3.includes(r.json.records[0].author.split(' ')[0]), `${r.json?.records?.[0]?.author}`);
// 6. homónimas del maestro (mismo nombre) distinguidas por cédula
const dup = Object.entries(raw.reduce((m, x) => ((m[x[1].split(' ').slice(0, 2).join(' ')] ||= []).push(x), m), {})).find(([, v]) => v.length === 2);
if (dup) {
  const [nm, [p1, p2]] = dup;
  r = await call('chats', [chat('d1', `Soy ${nm}, mi cédula es ${p1[3]}`, nm, 'x:1'), chat('d2', `Soy ${nm}, mi cédula es ${p2[3]}`, nm, 'y:1')]);
  const e1 = byOrig(p1[3]), e2 = byOrig(p2[3]);
  const o1 = r.json?.records?.[0]?.text || '', o2 = r.json?.records?.[1]?.text || '';
  check(`homónimas del maestro (${nm}) → cada una su seudónimo`, e1 && e2 && o1.includes(e1.pseudonyms.name.split(' ')[0]) && o2.includes(e2.pseudonyms.name.split(' ')[0]), `${o1} | ${o2}`);
}
// 7. lote de 50 mezclado con registros incompletos
const batch = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? { id: `m${i}`, text: `hola ${raw[i][1]}` } : chat(`m${i}`, `Caso ${i}: ${raw[i][1]} pagó por PSE desde Bancolombia, cédula ${raw[i][3]}`, raw[i][1])));
r = await call('chats', batch);
const leaks = (r.json?.records || []).filter((x, i) => x && (x.text || '').includes(raw[i][3]));
check('lote de 50 con registros incompletos', r.status === 200 && r.json.records.length === 50 && !leaks.length && r.ms < 60000, `${r.status} ${r.ms}ms fugas=${leaks.length}`);
// 8. documento y fila de tabla en vivo
r = await call('docs', [{ id: 'ld1', format: 'md', filename: `informe_${fullName.toLowerCase().split(' ').slice(0, 2).join('_')}.md`, title: 'Informe', body: `---\nauthor: ${correo}\n---\nCliente ${fullName} (${cid}) con celular ${celular}.`, metadata: { author: correo } }]);
const d = r.json?.records?.[0];
check('documento en vivo', r.status === 200 && d && !JSON.stringify(d).includes(correo) && !JSON.stringify(d).includes(fullName.split(' ')[0] + ' ' + fullName.split(' ')[1]), `${r.status} ${d?.filename}`);
const row = tables.find(t => t.table === 'clientes');
r = await call('tables', [{ id: 'clientes:CL-99999', table: 'clientes', columns: { cliente_id: 'CL-99999', nombre_completo: 'Yolima Barragán Cifuentes', tipo_doc: 'CC', num_doc: '1012345678', correo: 'ybarragan@gmail.com', celular: '3001112233', ciudad: 'Cali', barrio: 'Granada', direccion: 'Calle 5 # 38-20', fecha_nacimiento: '1990-01-01', fecha_vinculacion: '2024-01-01', ocupacion: 'periodista', notas: '' } }]);
const tr = r.json?.records?.[0]?.columns;
check('fila nueva de clientes', r.status === 200 && tr && tr.nombre_completo !== 'Yolima Barragán Cifuentes' && tr.num_doc !== '1012345678', `${r.status} ${tr?.nombre_completo}`);
check('entities en la respuesta', Array.isArray(r.json?.entities) && r.json.entities.length > 0);
// 8b. casos que encontró Elizabeth: nombre fuera de catálogo tras una pista, e "ID" como pista de cédula
r = await call('chats', [chat('e1', 'Hola, soy Rigoberta Quintanilla, mi ID 5671884619 y mi placa JQX-221', 'Rigoberta Quintanilla')]);
const te = r.json?.records?.[0]?.text || '';
check('nombre fuera de catálogo tras "soy"', r.status === 200 && !/Rigoberta|Quintanilla/.test(te) && !/Rigoberta|Quintanilla/.test(r.json?.records?.[0]?.author || ''), `"${te}"`);
check('número tras "ID" se cambia', r.status === 200 && !te.includes('5671884619'), `"${te}"`);
// 8c. batería manual de Elizabeth (Pruebas_anonymize_Vercel.xlsx): [caso, texto, no debe quedar, sí debe quedar]
const ELI = [
  ['minúsculas', 'hola me llamo pedro ramírez y necesito ayuda', ['pedro', 'ramírez'], []],
  ['MAYÚSCULAS', 'Encontré una cuenta a nombre de RIGOBERTA QUINTANILLA SOTO.', ['RIGOBERTA', 'QUINTANILLA'], []],
  ['fuera de catálogo', 'Hola, soy Rigoberta Quintanilla', ['Rigoberta', 'Quintanilla'], []],
  ['inglés', 'Hi, my name is John Smith and my phone is 3001234567', ['John Smith', '3001234567'], []],
  ['partícula del', 'Soy María del Pilar Gómez Restrepo, clienta nueva', ['Pilar', 'Gómez Restrepo', 'María del'], []],
  ['cuenta con guiones', 'consignen a la cuenta de ahorros 123-456789-01', ['123-456789-01'], []],
  ['firma', 'Gracias. — Rigoberta', ['Rigoberta'], []],
  ['ID y DOB', 'Marcela Román Acevedo, DOB 01/08/1993, ID 5671884619', ['Román Acevedo', '01/08/1993', '5671884619'], []],
  ['correo deletreado', 'mi correo es rigo punto quinta arroba yahoo punto com', ['rigo punto quinta'], []],
  ['celular +57', 'llámenme al +57 310 555 1234', ['310 555 1234'], []],
  ['celular guiones', 'mi cel es 310-555-1234', ['310-555-1234'], []],
  ['cédula sin puntos', 'CC 1020304050', ['1020304050'], []],
  ['pasaporte', 'pasaporte AB1234567', ['AB1234567'], []],
  ['placa moto', 'placa de la moto ABC12D', ['ABC12D'], []],
  ['dirección', 'vivo en la Calle 45 # 12-34 apto 501', ['Calle 45 # 12-34'], []],
  ['nacimiento en palabras', 'nací el 3 de marzo de 1990', ['3 de marzo de 1990'], []],
  ['inicial + apellido', 'pero en el extracto ese movimiento aparece como G. Londoño', ['G. Londoño'], []],
  ['@usuario', 'escríbanle a @juan.perez por favor', ['juan.perez'], []],
  ['mailto', 'escriban a <mailto:rigo@empresa.co|rigo@empresa.co>', ['rigo@empresa.co'], []],
  ['tercero', 'mi esposo Hernán Patiño también tiene cuenta', ['Hernán Patiño'], []],
  ['cuasi-identificador', 'soy enfermera, vivo en Chapinero y soy cliente desde 2019', ['enfermera', 'Chapinero', '2019'], []],
  ['falsos positivos', 'Pagué con Nequi en Carulla, fui a Plaza Botero a ver a Shakira y tengo cuenta en Banco de Bogotá', [], ['Nequi', 'Carulla', 'Plaza Botero', 'Shakira', 'Banco de Bogotá']],
  ['monto', 'me cobraron 1.350.000 dos veces', [], ['1.350.000']],
  ['uid desconocido', '<@U99999XYZ> revisa esto', ['U99999XYZ'], []],
  ['señora + apellido', 'La señora Castilla llamó otra vez', ['Castilla'], []],
  ['no es nombre', 'Soy Yesenia de soporte, soy cliente', [], ['de soporte', 'soy cliente']],
];
r = await call('chats', ELI.map(([, text], i) => chat(`eli${i}`, text, '', `eli:${i}`)));
ELI.forEach(([name, , gone, stay], i) => {
  const t = r.json?.records?.[i]?.text || '';
  check(`Eli · ${name}`, r.status === 200 && gone.every(g => !t.includes(g)) && stay.every(s => t.includes(s)), `"${t}"`);
});
// 9. fuente inválida → 422, no 500
r = await call('nada', []);
check('fuente inválida responde 422', r.status === 422, `${r.status}`);
void row;
if (!quiet) console.log(`\nen vivo: ${ok}/${total}`);
return { ok, total, fails };
}

export function httpCaller(base) {
  return async (source, records) => {
    const t0 = Date.now();
    const r = await fetch(`${base}/anonymize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, records }) });
    const ms = Date.now() - t0;
    const body = await r.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* error */ }
    return { status: r.status, ms, json, body };
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base = 'http://localhost:9000/v1', out = 'output'] = process.argv.slice(2);
  await runLiveCases(httpCaller(base), out);
}
