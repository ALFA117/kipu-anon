// Vigila el API de fuentes y avisa cuando crece (el "incidente"): compara el record_index del API contra
// el de la última descarga local. Usa 1 petición por consulta; NO llama al servicio ni gasta corridas.
// uso: node scripts/watch-sources.js            (una consulta)
//      node scripts/watch-sources.js --loop 60  (consulta cada 60 s y termina cuando detecta el cambio)
import fs from 'node:fs';

const env = Object.fromEntries((fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = process.env.FUENTES_API || env.FUENTES_API;
const TOKEN = process.env.FUENTES_TOKEN || env.FUENTES_TOKEN;
const BASE = 'data/record_index.json';
const loop = process.argv.includes('--loop') ? +process.argv[process.argv.indexOf('--loop') + 1] || 60 : 0;

const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const count = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length]));
const hora = () => new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

async function once() {
  const r = await fetch(`${API.replace(/\/+$/, '')}/record_index`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) { console.log(`${hora()} API respondió ${r.status}`); return false; }
  const now = await r.json();
  const a = count(base), b = count(now);
  const grew = Object.keys(b).some(k => (b[k] || 0) > (a[k] || 0)) || Object.keys(b).length > Object.keys(a).length;
  const detail = Object.keys(b).map(k => `${k} ${a[k] ?? 0}→${b[k]}`).join(' · ');
  console.log(`${hora()} ${grew ? 'CAMBIO DETECTADO' : 'sin cambios'} · ${detail}`);
  if (grew) fs.writeFileSync('data/record_index.nuevo.json', JSON.stringify(now));
  return grew;
}

if (!loop) await once();
else {
  for (;;) {
    if (await once()) break;
    await new Promise(s => setTimeout(s, loop * 1000));
  }
}
